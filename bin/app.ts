#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InterpreterStack } from '../lib/interpreter-stack.ts';

const app = new cdk.App();

// Region: `-c region=us-west-2` > CDK_DEPLOY_REGION > AWS_REGION > ap-northeast-1 (Tokyo)
const region =
  app.node.tryGetContext('region') ??
  process.env.CDK_DEPLOY_REGION ??
  process.env.AWS_REGION ??
  'ap-northeast-1';

new InterpreterStack(app, app.node.tryGetContext('stackName') ?? 'RealtimeInterpreter', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
  description: 'Real-time simultaneous interpretation (Transcribe + Bedrock + Polly)',
});
