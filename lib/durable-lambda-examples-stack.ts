// lib/my-lambda-project-stack.ts
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import __dirname from "./dirname.cjs";
import path from "path";

export class DurableLambdasProjectStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const s3inputBucketName = "durable-test-input-bucket";
    const s3outputBucketName = "durable-test-output-bucket";

    const s3inputBucket = new cdk.aws_s3.Bucket(this, "S3InputBucket", {
      bucketName: s3inputBucketName,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const s3outputBucket = new cdk.aws_s3.Bucket(this, "S3OutputBucket", {
      bucketName: s3outputBucketName,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // This creates the Lambda and bundles the TS code automatically
    const s3CopyLambda = new NodejsFunction(this, "s3CopyLambda", {
      entry: path.join(__dirname, "../src/lambdas/s3copy/s3copy.ts"), // points to your lambda handler
      handler: "handler", // Exported function name
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(10),
      durableConfig: {
        executionTimeout: cdk.Duration.hours(2),
        retentionPeriod: cdk.Duration.days(7),
      },
    });

    s3inputBucket.grantRead(s3CopyLambda);
    s3outputBucket.grantWrite(s3CopyLambda);

    new cdk.CfnOutput(this, "s3CopyLambdaArn", {
      value: s3CopyLambda.functionArn,
    });
  }
}
