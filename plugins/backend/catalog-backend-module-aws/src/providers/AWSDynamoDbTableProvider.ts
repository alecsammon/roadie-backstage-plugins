/*
 * Copyright 2021 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { Config } from '@backstage/config';
import * as winston from 'winston';
import { AWSEntityProvider } from './AWSEntityProvider';

/**
 * Provides entities from AWS DynamoDB service.
 */
export class AWSDynamoDbTableProvider extends AWSEntityProvider {
  static fromConfig(config: Config, options: { logger: winston.Logger }) {
    const accountId = config.getString('accountId');
    const roleArn = config.getString('roleArn');
    const externalId = config.getOptionalString('externalId');
    const region = config.getString('region');

    return new AWSDynamoDbTableProvider(
      { accountId, roleArn, externalId, region },
      options,
    );
  }

  getProviderName(): string {
    return `aws-dynamo-db-table-${this.accountId}`;
  }

  async run(): Promise<void> {
    if (!this.connection) {
      throw new Error('Not initialized');
    }

    const credentials = this.getCredentials();
    const ddb = new DynamoDB({ credentials });
    const defaultAnnotations = await this.buildDefaultAnnotations();

    this.logger.info(
      `Retrieving all DynamoDB tables for account ${this.accountId}`,
    );
    const tables = await ddb.listTables({});

    const ddbComponents = tables.TableNames
      ? (
          await Promise.all(
            tables.TableNames.map(async tableName => {
              const tableDescriptionResult = await ddb.describeTable({
                TableName: tableName,
              });
              const table = tableDescriptionResult.Table;
              if (table && table.TableName && table.TableArn) {
                return {
                  kind: 'Component',
                  apiVersion: 'backstage.io/v1beta1',
                  metadata: {
                    annotations: {
                      ...defaultAnnotations,
                      'amazon.com/dynamo-db-table-arn': table.TableArn,
                    },
                    name: table.TableName.slice(0, 62),
                  },
                  spec: {
                    owner: this.accountId,
                    type: 'dynamo-db-table',
                    lifecycle: 'production',
                  },
                };
              }
              return null;
            }),
          )
        )
          .filter(it => it)
          .map(it => it!)
      : [];

    await this.connection.applyMutation({
      type: 'full',
      entities: ddbComponents.map(entity => ({
        entity,
        locationKey: `aws-dynamo-db-table-provider:${this.accountId}`,
      })),
    });
  }
}
