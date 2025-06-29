import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  STSClient,
  GetCallerIdentityCommand,
  AssumeRoleCommand,
  AssumeRoleResponse
} from '@aws-sdk/client-sts';
import {
  IAMClient,
  GetRoleCommand,
  ListAttachedRolePoliciesCommand,
  GetPolicyCommand,
  SimulatePrincipalPolicyCommand
} from '@aws-sdk/client-iam';
import {
  CloudTrailClient,
  LookupEventsCommand,
  Event as CloudTrailEvent
} from '@aws-sdk/client-cloudtrail';

export interface SecurityConfiguration {
  roleArn: string;
  permissions: string[];
  policies: {
    name: string;
    arn: string;
    version: string;
  }[];
  lastValidated: Date;
  securityScore: number;
}

export interface AuditLogEntry {
  eventId: string;
  eventTime: Date;
  eventName: string;
  eventSource: string;
  userIdentity: {
    type: string;
    principalId?: string;
    arn?: string;
    accountId?: string;
  };
  sourceIPAddress?: string;
  userAgent?: string;
  errorCode?: string;
  errorMessage?: string;
}

@Injectable()
export class AWSSecurityService {
  private readonly logger = new Logger(AWSSecurityService.name);
  private readonly stsClient: STSClient;
  private readonly iamClient: IAMClient;
  private readonly cloudTrailClient: CloudTrailClient;
  private readonly region: string;

  // Security configuration cache
  private securityConfigCache: SecurityConfiguration | null = null;
  private cacheExpiry: Date | null = null;
  private readonly CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly configService: ConfigService) {
    this.region = this.configService.get('AWS_REGION', 'us-west-2');
    
    this.stsClient = new STSClient({ region: this.region });
    this.iamClient = new IAMClient({ region: this.region });
    this.cloudTrailClient = new CloudTrailClient({ region: this.region });
    
    this.logger.log('AWS Security Service initialized for credential management and audit logging');
  }

  // PHASE 6.5.5: Security and Permissions Implementation

  async validateAWSCredentials(): Promise<{
    valid: boolean;
    accountId?: string;
    arn?: string;
    userId?: string;
    error?: string;
  }> {
    this.logger.log('🔐 Validating AWS credentials and permissions');
    
    try {
      const command = new GetCallerIdentityCommand({});
      const response = await this.stsClient.send(command);
      
      return {
        valid: true,
        accountId: response.Account,
        arn: response.Arn,
        userId: response.UserId
      };
    } catch (error) {
      this.logger.error('Failed to validate AWS credentials:', error);
      return {
        valid: false,
        error: error.message || 'Unknown credential validation error'
      };
    }
  }

  async getSecurityConfiguration(): Promise<SecurityConfiguration> {
    this.logger.log('🛡️ Getting AWS security configuration');
    
    // Check cache first
    if (this.securityConfigCache && this.cacheExpiry && new Date() < this.cacheExpiry) {
      this.logger.log('Returning cached security configuration');
      return this.securityConfigCache;
    }

    try {
      const credentialValidation = await this.validateAWSCredentials();
      if (!credentialValidation.valid) {
        throw new Error(`Invalid AWS credentials: ${credentialValidation.error}`);
      }

      // Get the current role ARN (if using assumed role)
      const roleArn = credentialValidation.arn || '';
      
      // Get role permissions if using an IAM role
      let permissions: string[] = [];
      let policies: { name: string; arn: string; version: string; }[] = [];
      
      if (roleArn.includes('role/')) {
        const roleName = roleArn.split('/').pop();
        if (roleName) {
          const rolePermissions = await this.getRolePermissions(roleName);
          permissions = rolePermissions.permissions;
          policies = rolePermissions.policies;
        }
      }

      // Calculate security score based on permissions
      const securityScore = this.calculateSecurityScore(permissions);

      const config: SecurityConfiguration = {
        roleArn,
        permissions,
        policies,
        lastValidated: new Date(),
        securityScore
      };

      // Cache the result
      this.securityConfigCache = config;
      this.cacheExpiry = new Date(Date.now() + this.CACHE_DURATION_MS);

      return config;
    } catch (error) {
      this.logger.error('Failed to get security configuration:', error);
      throw new Error(`Failed to get security configuration: ${error.message}`);
    }
  }

  private async getRolePermissions(roleName: string): Promise<{
    permissions: string[];
    policies: { name: string; arn: string; version: string; }[];
  }> {
    try {
      // Get attached policies
      const listPoliciesCommand = new ListAttachedRolePoliciesCommand({
        RoleName: roleName
      });
      
      const policiesResponse = await this.iamClient.send(listPoliciesCommand);
      const attachedPolicies = policiesResponse.AttachedPolicies || [];

      const policies: { name: string; arn: string; version: string; }[] = [];
      const permissions = new Set<string>();

      // Get details for each policy
      for (const policy of attachedPolicies) {
        if (policy.PolicyArn && policy.PolicyName) {
          try {
            const getPolicyCommand = new GetPolicyCommand({
              PolicyArn: policy.PolicyArn
            });
            
            const policyResponse = await this.iamClient.send(getPolicyCommand);
            
            policies.push({
              name: policy.PolicyName,
              arn: policy.PolicyArn,
              version: policyResponse.Policy?.DefaultVersionId || 'unknown'
            });

            // Extract permissions from common AWS managed policies
            const policyPermissions = this.extractPermissionsFromPolicyName(policy.PolicyName);
            policyPermissions.forEach(perm => permissions.add(perm));
            
          } catch (policyError) {
            this.logger.warn(`Failed to get policy details for ${policy.PolicyName}:`, policyError);
          }
        }
      }

      return {
        permissions: Array.from(permissions),
        policies
      };
    } catch (error) {
      this.logger.error(`Failed to get role permissions for ${roleName}:`, error);
      return {
        permissions: [],
        policies: []
      };
    }
  }

  private extractPermissionsFromPolicyName(policyName: string): string[] {
    // Map common AWS managed policies to their key permissions
    const policyPermissionMap: Record<string, string[]> = {
      'CloudWatchReadOnlyAccess': [
        'cloudwatch:GetMetricStatistics',
        'cloudwatch:GetMetricData',
        'cloudwatch:DescribeAlarms'
      ],
      'CloudWatchLogsReadOnlyAccess': [
        'logs:DescribeLogGroups',
        'logs:FilterLogEvents',
        'logs:StartQuery',
        'logs:GetQueryResults'
      ],
      'CostExplorerServiceRolePolicy': [
        'ce:GetCostAndUsage',
        'ce:GetUsageForecast',
        'ce:GetCostCategories'
      ],
      'AWSLambdaReadOnlyAccess': [
        'lambda:ListFunctions',
        'lambda:GetFunction',
        'lambda:GetAccountSettings'
      ],
      'AWSStepFunctionsReadOnlyAccess': [
        'states:ListExecutions',
        'states:DescribeExecution',
        'states:GetExecutionHistory'
      ],
      'AmazonS3ReadOnlyAccess': [
        's3:GetBucketMetrics',
        's3:ListBuckets',
        's3:GetObject'
      ]
    };

    return policyPermissionMap[policyName] || [];
  }

  private calculateSecurityScore(permissions: string[]): number {
    // Required permissions for ForestShield AWS monitoring
    const requiredPermissions = [
      'cloudwatch:GetMetricStatistics',
      'logs:FilterLogEvents',
      'ce:GetCostAndUsage',
      'lambda:ListFunctions',
      'states:ListExecutions'
    ];

    const hasRequiredPermissions = requiredPermissions.filter(perm => 
      permissions.some(userPerm => userPerm.includes(perm.split(':')[1]))
    ).length;

    // Score based on percentage of required permissions
    const baseScore = (hasRequiredPermissions / requiredPermissions.length) * 70;
    
    // Bonus points for additional security-related permissions
    const securityBonuses = [
      'iam:GetRole',
      'cloudtrail:LookupEvents',
      'sts:GetCallerIdentity'
    ];

    const bonusScore = securityBonuses.filter(perm => 
      permissions.some(userPerm => userPerm.includes(perm.split(':')[1]))
    ).length * 10;

    return Math.min(100, baseScore + bonusScore);
  }

  // PHASE 6.5.5: Audit Logging Implementation

  async getAuditLogs(
    startTime?: Date,
    endTime?: Date,
    eventNames?: string[],
    limit: number = 50
  ): Promise<AuditLogEntry[]> {
    this.logger.log('📋 Fetching AWS CloudTrail audit logs');
    
    try {
      const lookupStartTime = startTime || new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours
      const lookupEndTime = endTime || new Date();

      const command = new LookupEventsCommand({
        StartTime: lookupStartTime,
        EndTime: lookupEndTime,
        MaxResults: limit
      });

      const response = await this.cloudTrailClient.send(command);
      
      return (response.Events || []).map(event => this.mapCloudTrailEvent(event));
    } catch (error) {
      this.logger.error('Failed to fetch audit logs:', error);
      throw new Error(`AWS CloudTrail unavailable: ${error.message}`);
    }
  }

  async getForestShieldAuditLogs(limit: number = 50): Promise<AuditLogEntry[]> {
    this.logger.log('🛡️ Fetching ForestShield-specific audit logs');
    
    // Filter for ForestShield-related events
    const forestShieldEventNames = [
      'InvokeFunction',
      'StartExecution',
      'GetObject',
      'PutObject',
      'GetMetricStatistics',
      'FilterLogEvents'
    ];

    return this.getAuditLogs(
      new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      new Date(),
      forestShieldEventNames,
      limit
    );
  }

  private mapCloudTrailEvent(event: CloudTrailEvent): AuditLogEntry {
    return {
      eventId: event.EventId || 'unknown',
      eventTime: event.EventTime || new Date(),
      eventName: event.EventName || 'unknown',
      eventSource: event.EventSource || 'unknown',
      userIdentity: {
        type: (event as any).UserIdentity?.type || 'unknown',
        principalId: (event as any).UserIdentity?.principalId,
        arn: (event as any).UserIdentity?.arn,
        accountId: (event as any).UserIdentity?.accountId
      },
      sourceIPAddress: (event as any).SourceIPAddress,
      userAgent: (event as any).UserAgent,
      errorCode: (event as any).ErrorCode,
      errorMessage: (event as any).ErrorMessage
    };
  }

  // Security validation methods

  async validateRequiredPermissions(): Promise<{
    valid: boolean;
    missingPermissions: string[];
    securityRecommendations: string[];
  }> {
    this.logger.log('🔍 Validating required AWS permissions');
    
    try {
      const config = await this.getSecurityConfiguration();
      
      const requiredPermissions = [
        'cloudwatch:GetMetricStatistics',
        'logs:FilterLogEvents', 
        'ce:GetCostAndUsage',
        'lambda:ListFunctions',
        'states:ListExecutions',
        's3:GetBucketMetrics'
      ];

      const missingPermissions = requiredPermissions.filter(required => 
        !config.permissions.some(userPerm => 
          userPerm.includes(required.split(':')[1])
        )
      );

      const securityRecommendations: string[] = [];
      
      if (missingPermissions.length > 0) {
        securityRecommendations.push('Grant missing permissions for full functionality');
      }
      
      if (config.securityScore < 80) {
        securityRecommendations.push('Consider adding additional security-related permissions');
      }
      
      if (!config.roleArn.includes('role/')) {
        securityRecommendations.push('Use IAM roles instead of user credentials for better security');
      }

      return {
        valid: missingPermissions.length === 0,
        missingPermissions,
        securityRecommendations
      };
    } catch (error) {
      this.logger.error('Failed to validate permissions:', error);
      return {
        valid: false,
        missingPermissions: ['Unable to validate permissions'],
        securityRecommendations: ['Check AWS credentials and IAM configuration']
      };
    }
  }

  async getSecurityHealthCheck(): Promise<{
    overall_security: 'secure' | 'moderate' | 'at_risk';
    credential_status: 'valid' | 'invalid' | 'unknown';
    permission_score: number;
    audit_log_access: boolean;
    recommendations: string[];
    last_check: Date;
  }> {
    this.logger.log('🏥 Performing comprehensive security health check');
    
    try {
      const [credentialValidation, permissionValidation, config] = await Promise.all([
        this.validateAWSCredentials(),
        this.validateRequiredPermissions(),
        this.getSecurityConfiguration()
      ]);

      // Test audit log access
      let auditLogAccess = false;
      try {
        await this.getAuditLogs(new Date(Date.now() - 60000), new Date(), [], 1);
        auditLogAccess = true;
      } catch {
        auditLogAccess = false;
      }

      const recommendations: string[] = [];
      
      if (!credentialValidation.valid) {
        recommendations.push('Fix AWS credential configuration');
      }
      
      if (!permissionValidation.valid) {
        recommendations.push(...permissionValidation.securityRecommendations);
      }
      
      if (!auditLogAccess) {
        recommendations.push('Enable CloudTrail for audit logging');
      }

      // Calculate overall security status
      let overallSecurity: 'secure' | 'moderate' | 'at_risk' = 'secure';
      
      if (!credentialValidation.valid || config.securityScore < 50) {
        overallSecurity = 'at_risk';
      } else if (!permissionValidation.valid || config.securityScore < 80 || !auditLogAccess) {
        overallSecurity = 'moderate';
      }

      return {
        overall_security: overallSecurity,
        credential_status: credentialValidation.valid ? 'valid' : 'invalid',
        permission_score: config.securityScore,
        audit_log_access: auditLogAccess,
        recommendations,
        last_check: new Date()
      };
    } catch (error) {
      this.logger.error('Failed to perform security health check:', error);
      return {
        overall_security: 'at_risk',
        credential_status: 'unknown',
        permission_score: 0,
        audit_log_access: false,
        recommendations: ['Unable to perform security check - verify AWS configuration'],
        last_check: new Date()
      };
    }
  }



  // Cache management

  clearSecurityCache(): void {
    this.logger.log('🧹 Clearing security configuration cache');
    this.securityConfigCache = null;
    this.cacheExpiry = null;
  }

  getSecurityCacheStatus(): {
    cached: boolean;
    expiresAt?: Date;
    cacheAge?: number;
  } {
    if (!this.securityConfigCache || !this.cacheExpiry) {
      return { cached: false };
    }

    return {
      cached: true,
      expiresAt: this.cacheExpiry,
      cacheAge: Date.now() - (this.cacheExpiry.getTime() - this.CACHE_DURATION_MS)
    };
  }
} 