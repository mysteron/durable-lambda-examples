import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  DurableContext,
  DurableExecutionHandler,
  withDurableExecution,
} from "@aws/durable-execution-sdk-js";
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCopyCommand,
} from "@aws-sdk/client-s3";

export type CopyEvent = {
  sourceBucket: string;
  sourceKey: string;
  destinationBucket: string;
  destinationKey: string;
};

export type CopyResult = {
  success: boolean;
  message: string;
};

export type CopyPartState = {
  PartNumber: number;
  completedParts: { ETag: string; PartNumber: number }[];
  totalParts: number;
};
const PART_SIZE = 100 * 1024 * 1024; // 100 MB (minimum is 5 MB)

const durableCopyHandler: DurableExecutionHandler<
  CopyEvent,
  CopyResult
> = async (event: CopyEvent, context: DurableContext): Promise<CopyResult> => {
  console.log("Durable Event: ", JSON.stringify(event, null, 2));

  const { sourceBucket, sourceKey, destinationBucket, destinationKey } = event;
  const s3 = new S3Client({});

  const headStep = await context.step("HeadObject", async () => {
    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: sourceBucket,
        Key: sourceKey,
      })
    );
    if (!head.ContentLength) {
      throw new Error("Source object does not exist or is empty");
    }
    return {
      contentLenghth: head.ContentLength,
    };
  });

  const objectSize = headStep.contentLenghth;
  const totalParts = Math.ceil(objectSize / PART_SIZE);
  const createUploadStep = await context.step(
    "CreateMultipartUpload",
    async () => {
      const createUpload = await s3.send(
        new CreateMultipartUploadCommand({
          Bucket: destinationBucket,
          Key: destinationKey,
        })
      );
      return createUpload;
    }
  );

  const uploadId = createUploadStep.UploadId!;

  const loopStep = await context.waitForCondition(
    async (state) => {
      const partNumber = state.PartNumber;
      const start = (partNumber - 1) * PART_SIZE;
      const end = Math.min(start + PART_SIZE - 1, objectSize - 1);

      const copyResult = await s3.send(
        new UploadPartCopyCommand({
          Bucket: destinationBucket,
          Key: destinationKey,
          PartNumber: state.PartNumber,
          UploadId: uploadId,
          CopySource: `${sourceBucket}/${encodeURIComponent(sourceKey)}`,
          CopySourceRange: `bytes=${start}-${end}`,
        })
      );
      if (!copyResult.CopyPartResult?.ETag) {
        throw new Error(`Missing ETag for part ${partNumber}`);
      }

      state.completedParts.push({
        ETag: copyResult.CopyPartResult.ETag,
        PartNumber: partNumber,
      });

      return {
        PartNumber: partNumber + 1,
        completedParts: state.completedParts,
        totalParts,
      } as CopyPartState;
    },
    {
      initialState: {
        PartNumber: 1,
        completedParts: [],
        totalParts,
      } as CopyPartState,
      waitStrategy: (state) =>
        state.PartNumber > state.totalParts
          ? { shouldContinue: false }
          : { shouldContinue: true, delay: { seconds: 1 } },
    }
  );

  const completeUploadStep = await context.step(
    "CompleteMultipartUpload",
    async () => {
      // Complete the multipart upload
      const completedUpload = await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket: destinationBucket,
          Key: destinationKey,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: loopStep.completedParts,
          },
        })
      );
      return completedUpload;
    }
  );

  return {
    success: true,
    message: `Copy completed: ${completeUploadStep.Location}`,
  };
};

export const handler = withDurableExecution<CopyEvent, CopyResult>(
  durableCopyHandler
);
