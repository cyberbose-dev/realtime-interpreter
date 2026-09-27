import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { defaultModelId, modelResourceArns } from './models.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Everything is behind one HTTP API:
 *   GET  /            -> web Lambda (serves the SPA and /config.json)
 *   POST /api/{op}    -> api Lambda (Cognito JWT required)
 * The browser streams audio straight to Transcribe with a presigned URL issued by the api Lambda.
 */
export class InterpreterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const ctx = (key: string) => this.node.tryGetContext(key) as string | undefined;
    const draftModelId = ctx('draftModelId') ?? defaultModelId(this.region, 'amazon.nova-2-lite-v1:0');
    const finalModelId = ctx('finalModelId') ?? defaultModelId(this.region, 'anthropic.claude-haiku-4-5-20251001-v1:0');
    const rateLimit = Number(ctx('throttleRate') ?? 20);
    const burstLimit = Number(ctx('throttleBurst') ?? 40);

    // ---------- Auth (Cognito managed login, self sign-up with e-mail verification) ----------
    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: ctx('selfSignUp') !== 'false',
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      passwordPolicy: { minLength: 10, requireSymbols: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const seed = cdk.Token.isUnresolved(this.account) ? cdk.Names.uniqueId(this) : `${this.account}-${this.region}-${id}`;
    const domainPrefix = ctx('domainPrefix') ?? `simul-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
    const domain = userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    // ---------- Lambdas ----------
    const logGroup = (name: string) =>
      new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

    const common = {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      bundling: {
        format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
        minify: true,
        target: 'node24',
        // Some AWS SDK dependencies still call require() for Node built-ins.
        banner: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    };

    const apiFn = new NodejsFunction(this, 'ApiFn', {
      ...common,
      entry: path.join(root, 'lambda/api.ts'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(29),
      logGroup: logGroup('ApiFn'),
      environment: { DRAFT_MODEL_ID: draftModelId, FINAL_MODEL_ID: finalModelId },
    });
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          ...modelResourceArns(this.region, this.account, draftModelId),
          ...modelResourceArns(this.region, this.account, finalModelId),
        ],
      }),
    );
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        // Neither action supports resource-level permissions.
        actions: ['transcribe:StartStreamTranscriptionWebSocket', 'polly:SynthesizeSpeech'],
        resources: ['*'],
      }),
    );

    // ---------- HTTP API ----------
    const api = new apigw.HttpApi(this, 'HttpApi', { description: 'Simultaneous interpreter' });
    const stage = api.defaultStage!.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: rateLimit, throttlingBurstLimit: burstLimit };

    const appUrl = api.url!; // https://{id}.execute-api.{region}.amazonaws.com/
    const client = userPool.addClient('WebClient', {
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: [appUrl],
        logoutUrls: [appUrl],
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.hours(12),
      preventUserExistenceErrors: true,
    });
    new cognito.CfnManagedLoginBranding(this, 'LoginBranding', {
      userPoolId: userPool.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    const webFn = new NodejsFunction(this, 'WebFn', {
      ...common,
      entry: path.join(root, 'lambda/web.ts'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(5),
      logGroup: logGroup('WebFn'),
      environment: {
        CLIENT_ID: client.userPoolClientId,
        COGNITO_DOMAIN: domain.baseUrl(),
      },
      bundling: {
        ...common.bundling,
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          // The built SPA (web/dist) ships inside the Lambda package.
          afterBundling: (inputDir: string, outputDir: string) => [`cp -R "${inputDir}/web/dist" "${outputDir}/site"`],
        },
      },
    });

    const authorizer = new HttpUserPoolAuthorizer('CognitoAuthorizer', userPool, { userPoolClients: [client] });
    const webIntegration = new HttpLambdaIntegration('WebIntegration', webFn);
    api.addRoutes({ path: '/', methods: [apigw.HttpMethod.GET], integration: webIntegration });
    api.addRoutes({ path: '/{proxy+}', methods: [apigw.HttpMethod.GET], integration: webIntegration });
    api.addRoutes({
      path: '/api/{op}',
      methods: [apigw.HttpMethod.POST],
      integration: new HttpLambdaIntegration('ApiIntegration', apiFn),
      authorizer,
    });

    new cdk.CfnOutput(this, 'AppUrl', { value: appUrl });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'ApiFunctionName', { value: apiFn.functionName });
    new cdk.CfnOutput(this, 'Models', { value: `draft=${draftModelId} final=${finalModelId}` });
  }
}
