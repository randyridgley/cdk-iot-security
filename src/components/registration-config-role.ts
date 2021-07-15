import {
  Role,
  ServicePrincipal,
  ManagedPolicy,
} from '@aws-cdk/aws-iam';
import { Construct } from '@aws-cdk/core';

export class ProvisionRole extends Role {
  constructor(scope: Construct, id: string) {
    super(scope, `ProvisionRole-${id}`, {
      roleName: `ProvisionRoleName-${id}`,
      assumedBy: new ServicePrincipal('iot.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSIoTThingsRegistration'),
      ],
    });
  }
}

export class JitpRole extends ProvisionRole {
  constructor(scope: Construct, id: string) {
    super(scope, `Jitp-${id}`);
  }
}

export class FleetProvisionRole extends ProvisionRole {
  constructor(scope: Construct, id: string) {
    super(scope, `Fleet-${id}`);
  }
}