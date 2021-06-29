import * as path from 'path';
import {
  IoTClient,
  GetRegistrationCodeCommand,
  RegisterCACertificateCommand,
  CreateTopicRuleCommand,
} from '@aws-sdk/client-iot';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  Request,
  Response,
} from '@softchef/lambda-events';
import * as Joi from 'joi';
import { CertificateGenerator } from './certificate-generator';
import {
  VerifierError,
  InputError,
} from './errors';

/**
 * event example
 *
 * event = {
 *  "csrSubjects": {
 *    "commonName": "", // It would be replaced by the registration code, thus is unnecessary.
 *    "countryName": "TW",
 *    "stateName": "TP",
 *    "localityName": "TW",
 *    "organizationName": "Soft Chef",
 *    "organizationUnitName": "web"
 *  },
 *  "verifierName": "verifier_name",
 *  }
 * }
 */

/**
 * The lambda function handler for register CA.
 * @param event The HTTP request from the API gateway.
 * @returns The HTTP response containing the registration result.
 */
export const handler = async (event: any = {}) : Promise <any> => {
  const request: Request = new Request(event);
  const response: Response = new Response();

  const bucketName: string | undefined = process.env.BUCKET_NAME;
  const bucketPrefix: string | undefined = process.env.BUCKET_PREFIX;
  const queueUrl: string | undefined = process.env.DEIVCE_ACTIVATOR_QUEUE_URL;
  const deviceActivatorRoleArn: string | undefined = process.env.DEIVCE_ACTIVATOR_ROLE_ARN;
  const region: string | undefined = process.env.AWS_REGION;

  const iotClient: IoTClient = new IoTClient({ region: region });
  const s3Client: S3Client = new S3Client({ region: region });

  const csrSubjectsSchema: Joi.ObjectSchema = Joi.object({
    commonName: Joi.string().allow(''),
    countryName: Joi.string().allow(''),
    stateName: Joi.string().allow(''),
    localityName: Joi.string().allow(''),
    organizationName: Joi.string().allow(''),
    organizationUnitName: Joi.string().allow(''),
  }).unknown(true).allow({}, null);

  const verifierSchema: Joi.AlternativesSchema = Joi.alternatives(
    Joi.object({
      verifierName: Joi.string().invalid('').required(),
      verifierArn: Joi.string().regex(/^arn:/).required(),
    }),
    Joi.object({
      verifierName: Joi.string().allow('', null).only(),
      verifierArn: Joi.string().default(''),
    }),
  );

  try {
    const validated = request.validate(joi => {
      return {
        csrSubjects: csrSubjectsSchema,
        verifierName: joi.string().allow('', null),
      };
    });
    if (validated.error) {
      throw new InputError(JSON.stringify(validated.details));
    }

    const { Payload: payload } = await new LambdaClient({}).send(
      new InvokeCommand({
        FunctionName: decodeURIComponent(process.env.FETCH_ALL_VERIFIER_HTTP_FUNCTION_ARN!),
        Payload: Buffer.from(''),
      }),
    );
    let payloadString: string = '';
    payload!.forEach(num => payloadString += String.fromCharCode(num));
    const { body } = JSON.parse(payloadString);
    let { verifiers = '{}' } = JSON.parse(body);
    verifiers = JSON.parse(verifiers);

    let csrSubjects: CertificateGenerator.CsrSubjects = request.input('csrSubjects') || {
      commonName: '',
      countryName: '',
      stateName: '',
      localityName: '',
      organizationName: '',
      organizationUnitName: '',
    };

    let verifierName: string = request.input('verifierName');
    const { verifierArn } = await verifierSchema.validateAsync({
      verifierName: verifierName,
      verifierArn: verifiers[verifierName],
    }).catch((error: Error) => {
      console.log(verifiers);
      console.log({
        verifierName,
        verifierArn: verifiers[verifierName],
      });
      throw new VerifierError(error.message);
    });

    const { registrationCode } = await iotClient.send(
      new GetRegistrationCodeCommand({}),
    );
    csrSubjects = Object.assign(csrSubjects, { commonName: registrationCode });

    let certificates: CertificateGenerator.CaRegistrationRequiredCertificates = CertificateGenerator.getCaRegistrationCertificates(csrSubjects);

    const {
      certificateId,
      certificateArn,
    } = await iotClient.send(
      new RegisterCACertificateCommand({
        caCertificate: certificates.ca.certificate,
        verificationCertificate: certificates.verification.certificate,
        allowAutoRegistration: true,
        registrationConfig: {},
        setAsActive: true,
      }),
    );

    await iotClient.send(
      new CreateTopicRuleCommand({
        ruleName: `ActivationRule_${certificateId}`,
        topicRulePayload: {
          actions: [
            {
              sqs: {
                queueUrl: queueUrl,
                roleArn: deviceActivatorRoleArn,
              },
            },
          ],
          sql: `SELECT *, "${verifierArn}" as verifierArn FROM '$aws/events/certificates/registered/${certificateId}'`,
        },
      }),
    );

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: path.join(bucketPrefix || '', certificateId!, 'ca-certificate.json'),
        Body: Buffer.from(JSON.stringify(Object.assign({}, certificates, {
          certificateId: certificateId,
          certificateArn: certificateArn,
        }))),
      }),
    );
    return response.json({ certificateId: certificateId });
  } catch (error) {
    return response.error(error, error.code);
  }
};