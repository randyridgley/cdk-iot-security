import {
  Role, PolicyStatement, Effect,
  ServicePrincipal, PolicyDocument, ManagedPolicy,
} from '@aws-cdk/aws-iam';
import { SqsEventSource } from '@aws-cdk/aws-lambda-event-sources';
import { NodejsFunction } from '@aws-cdk/aws-lambda-nodejs';
import { Queue } from '@aws-cdk/aws-sqs';
import { Construct } from '@aws-cdk/core';

export class ClientActivator extends Construct {
  public function: ActivationFunction;
  public role: Role;
  public receptor: Receptor;

  /**
   * Initialize the Client Activator.
   *
   * The Client Activator is mainly consist of three parts,
   * a Lambda Function providing the Activation functionality,
   * a Receptor which is a SQS Queue receiving the messages
   * from the CA-associated Iot Rules created by the Registrator,
   * and a Role allowing pushing to the Receptor for granting the
   * Iot Rule through the Registrator.
   *
   * @param scope
   * @param id
   */
  constructor(scope: Construct, id: string) {
    super(scope, `ClientActivator-${id}`);
    this.receptor = new Receptor(this, id);
    const activationRole = new ActivationRole(this, id);
    this.receptor.grantConsumeMessages(activationRole);
    this.function = new ActivationFunction(this, id, {
      activationRole: activationRole,
    });
    this.function.addEventSource(new SqsEventSource(this.receptor));
    this.role = this.receptor.getPushRole('iot.amazonaws.com');
    this.receptor.grantSendMessages(this.role);
  }
}

class Receptor extends Queue {
  /**
   * Initialize the SQS Queue receiving message from the CA-associated Iot Rules.
   * @param scope
   * @param id
   */
  constructor(scope: Construct, id: string) {
    super(scope, `Receptor-${id}`, {});
  }
  public getPushRole(principalName: string) {
    return new Role(this, `PushRole-${this.node.id}`, {
      roleName: `PushRole-${this.node.id}`,
      assumedBy: new ServicePrincipal(principalName),
      inlinePolicies: {
        SqsPushPolicy: new PolicyDocument({
          statements: [new PolicyStatement({
            actions: [
              'sqs:SendMessageBatch',
              'sqs:SendMessage',
            ],
            resources: [
              this.queueArn,
            ],
          })],
        }),
      },
    });
  }
}

interface ActivationFunctionProps {
  activationRole: Role;
}

class ActivationFunction extends NodejsFunction {
  /**
   * Inistialize the Activator Function.
   * @param scope
   * @param id
   * @param props
   */
  constructor(scope: Construct, id: string, props: ActivationFunctionProps) {
    console.log(`${process.env.APPS_PATH}/activator/index.js`);
    super(scope, `ActivatorFunction-${id}`, {
      entry: `${process.env.APPS_PATH}/activator/index.js`,
      role: props.activationRole,
    });
  }
}

class ActivationRole extends Role {
  /**
   * Initialize the Activator Role which allows the activator
   * to invoke other Lambda Functions, especially the verifier,
   * and operate the client certificates.
   * @param scope
   * @param id
   */
  constructor(scope: Construct, id:string) {
    super(scope, `ActivatorRole-${id}`, {
      roleName: `ActivatorRole-${id}`,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        CaRegistrationPolicy: new PolicyDocument({
          statements: [new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              'iot:UpdateCertificate',
              'iot:DescribeCertificate',
              'lambda:InvokeFunction',
              'lambda:InvokeAsync',
            ],
            resources: ['*'],
          })],
        }),
      },
    });
  }
}