"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppSyncTransformer = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const aws_appsync_1 = require("@aws-cdk/aws-appsync");
const aws_dynamodb_1 = require("@aws-cdk/aws-dynamodb");
const aws_iam_1 = require("@aws-cdk/aws-iam");
const core_1 = require("@aws-cdk/core");
const schema_transformer_1 = require("./transformer/schema-transformer");
const defaultAuthorizationConfig = {
    defaultAuthorization: {
        authorizationType: aws_appsync_1.AuthorizationType.API_KEY,
        apiKeyConfig: {
            description: 'Auto generated API Key from construct',
            name: 'dev',
        },
    },
};
/**
 * (experimental) AppSyncTransformer Construct.
 *
 * @experimental
 */
class AppSyncTransformer extends core_1.Construct {
    /**
     * @experimental
     */
    constructor(scope, id, props) {
        var _b, _c, _d, _e, _f, _g, _h, _j, _k;
        super(scope, id);
        this.props = props;
        this.tableMap = {};
        this.datasourceMap = {};
        this.isSyncEnabled = props.syncEnabled ? props.syncEnabled : false;
        this.pointInTimeRecovery = (_b = props.enableDynamoPointInTimeRecovery) !== null && _b !== void 0 ? _b : false;
        const transformerConfiguration = {
            schemaPath: props.schemaPath,
            syncEnabled: (_c = props.syncEnabled) !== null && _c !== void 0 ? _c : false,
        };
        // Combine the arrays so we only loop once
        // Test each transformer to see if it implements ITransformer
        const allCustomTransformers = [...(_d = props.preCdkTransformers) !== null && _d !== void 0 ? _d : [], ...(_e = props.postCdkTransformers) !== null && _e !== void 0 ? _e : []];
        if (allCustomTransformers && allCustomTransformers.length > 0) {
            allCustomTransformers.forEach(transformer => {
                if (transformer && !this.implementsITransformer(transformer)) {
                    throw new Error(`Transformer does not implement ITransformer from graphql-transformer-core: ${transformer}`);
                }
            });
        }
        const transformer = new schema_transformer_1.SchemaTransformer(transformerConfiguration);
        this.outputs = transformer.transform(props.preCdkTransformers, props.postCdkTransformers);
        const resolvers = transformer.getResolvers();
        this.functionResolvers = (_f = this.outputs.functionResolvers) !== null && _f !== void 0 ? _f : {};
        // Remove any function resolvers from the total list of resolvers
        // Otherwise it will add them twice
        for (const [_, functionResolvers] of Object.entries(this.functionResolvers)) {
            functionResolvers.forEach((resolver) => {
                switch (resolver.typeName) {
                    case 'Query':
                    case 'Mutation':
                    case 'Subscription':
                        delete resolvers[resolver.fieldName];
                        break;
                }
            });
        }
        this.httpResolvers = (_g = this.outputs.httpResolvers) !== null && _g !== void 0 ? _g : {};
        // Remove any http resolvers from the total list of resolvers
        // Otherwise it will add them twice
        for (const [_, httpResolvers] of Object.entries(this.httpResolvers)) {
            httpResolvers.forEach((resolver) => {
                switch (resolver.typeName) {
                    case 'Query':
                    case 'Mutation':
                    case 'Subscription':
                        delete resolvers[resolver.fieldName];
                        break;
                }
            });
        }
        this.resolvers = resolvers;
        this.nestedAppsyncStack = new core_1.NestedStack(this, (_h = props.nestedStackName) !== null && _h !== void 0 ? _h : 'appsync-nested-stack');
        // AppSync
        this.appsyncAPI = new aws_appsync_1.GraphqlApi(this.nestedAppsyncStack, `${id}-api`, {
            name: props.apiName ? props.apiName : `${id}-api`,
            authorizationConfig: props.authorizationConfig
                ? props.authorizationConfig
                : defaultAuthorizationConfig,
            logConfig: {
                fieldLogLevel: props.fieldLogLevel
                    ? props.fieldLogLevel
                    : aws_appsync_1.FieldLogLevel.NONE,
            },
            schema: aws_appsync_1.Schema.fromAsset('./appsync/schema.graphql'),
            xrayEnabled: (_j = props.xrayEnabled) !== null && _j !== void 0 ? _j : false,
        });
        let tableData = (_k = this.outputs.cdkTables) !== null && _k !== void 0 ? _k : {};
        // Check to see if sync is enabled
        if (tableData.DataStore) {
            this.isSyncEnabled = true;
            this.syncTable = this.createSyncTable(tableData.DataStore);
            delete tableData.DataStore; // We don't want to create this again below so remove it from the tableData map
        }
        this.tableNameMap = this.createTablesAndResolvers(tableData, resolvers, props.tableNames);
        if (this.outputs.noneResolvers) {
            this.createNoneDataSourceAndResolvers(this.outputs.noneResolvers, resolvers);
        }
        this.createHttpResolvers();
        this.publicResourceArns = this.getResourcesFromGeneratedRolePolicy(transformer.unauthRolePolicy);
        this.privateResourceArns = this.getResourcesFromGeneratedRolePolicy(transformer.authRolePolicy);
        // Outputs so we can generate exports
        new core_1.CfnOutput(scope, 'appsyncGraphQLEndpointOutput', {
            value: this.appsyncAPI.graphqlUrl,
            description: 'Output for aws_appsync_graphqlEndpoint',
        });
    }
    /**
     * graphql-transformer-core needs to be jsii enabled to pull the ITransformer interface correctly.
     * Since it's not in peer dependencies it doesn't show up in the jsii deps list.
     * Since it's not jsii enabled it has to be bundled.
     * The package can't be in BOTH peer and bundled dependencies
     * So we do a fake test to make sure it implements these and hope for the best
     * @param transformer
     */
    implementsITransformer(transformer) {
        return 'name' in transformer
            && 'directive' in transformer
            && 'typeDefinitions' in transformer;
    }
    /**
     * Creates NONE data source and associated resolvers
     * @param noneResolvers The resolvers that belong to the none data source
     * @param resolvers The resolver map minus function resolvers
     */
    createNoneDataSourceAndResolvers(noneResolvers, resolvers) {
        const noneDataSource = this.appsyncAPI.addNoneDataSource('NONE');
        Object.keys(noneResolvers).forEach((resolverKey) => {
            const resolver = resolvers[resolverKey];
            new aws_appsync_1.Resolver(this.nestedAppsyncStack, `${resolver.typeName}-${resolver.fieldName}-resolver`, {
                api: this.appsyncAPI,
                typeName: resolver.typeName,
                fieldName: resolver.fieldName,
                dataSource: noneDataSource,
                requestMappingTemplate: aws_appsync_1.MappingTemplate.fromFile(resolver.requestMappingTemplate),
                responseMappingTemplate: aws_appsync_1.MappingTemplate.fromFile(resolver.responseMappingTemplate),
            });
        });
    }
    /**
     * Creates each dynamodb table, gsis, dynamodb datasource, and associated resolvers
     * If sync is enabled then TTL configuration is added
     * Returns tableName: table map in case it is needed for lambda functions, etc
     * @param tableData The CdkTransformer table information
     * @param resolvers The resolver map minus function resolvers
     */
    createTablesAndResolvers(tableData, resolvers, tableNames = {}) {
        const tableNameMap = {};
        Object.keys(tableData).forEach((tableKey) => {
            var _b;
            const tableName = (_b = tableNames[tableKey]) !== null && _b !== void 0 ? _b : undefined;
            const table = this.createTable(tableData[tableKey], tableName);
            this.tableMap[tableKey] = table;
            const dataSource = this.appsyncAPI.addDynamoDbDataSource(tableKey, table);
            // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-appsync-datasource-deltasyncconfig.html
            if (this.isSyncEnabled && this.syncTable) {
                //@ts-ignore - ds is the base CfnDataSource and the db config needs to be versioned - see CfnDataSource
                dataSource.ds.dynamoDbConfig.versioned = true;
                //@ts-ignore - ds is the base CfnDataSource - see CfnDataSource
                dataSource.ds.dynamoDbConfig.deltaSyncConfig = {
                    baseTableTtl: '43200',
                    deltaSyncTableName: this.syncTable.tableName,
                    deltaSyncTableTtl: '30',
                };
                // Need to add permission for our datasource service role to access the sync table
                dataSource.grantPrincipal.addToPolicy(new aws_iam_1.PolicyStatement({
                    effect: aws_iam_1.Effect.ALLOW,
                    actions: [
                        'dynamodb:*',
                    ],
                    resources: [this.syncTable.tableArn],
                }));
            }
            const dynamoDbConfig = dataSource.ds
                .dynamoDbConfig;
            tableNameMap[tableKey] = dynamoDbConfig.tableName;
            //Expose datasource to support adding multiple resolvers
            this.datasourceMap[tableKey] = dataSource;
            // Loop the basic resolvers
            tableData[tableKey].resolvers.forEach((resolverKey) => {
                let resolver = resolvers[resolverKey];
                new aws_appsync_1.Resolver(this.nestedAppsyncStack, `${resolver.typeName}-${resolver.fieldName}-resolver`, {
                    api: this.appsyncAPI,
                    typeName: resolver.typeName,
                    fieldName: resolver.fieldName,
                    dataSource: dataSource,
                    requestMappingTemplate: aws_appsync_1.MappingTemplate.fromFile(resolver.requestMappingTemplate),
                    responseMappingTemplate: aws_appsync_1.MappingTemplate.fromFile(resolver.responseMappingTemplate),
                });
            });
            // Loop the gsi resolvers
            tableData[tableKey].gsiResolvers.forEach((resolverKey) => {
                let resolver = resolvers.gsi[resolverKey];
                new aws_appsync_1.Resolver(this.nestedAppsyncStack, `${resolver.typeName}-${resolver.fieldName}-resolver`, {
                    api: this.appsyncAPI,
                    typeName: resolver.typeName,
                    fieldName: resolver.fieldName,
                    dataSource: dataSource,
                    requestMappingTemplate: aws_appsync_1.MappingTemplate.fromFile(resolver.requestMappingTemplate),
                    responseMappingTemplate: aws_appsync_1.MappingTemplate.fromFile(resolver.responseMappingTemplate),
                });
            });
        });
        return tableNameMap;
    }
    createTable(tableData, tableName) {
        var _b;
        // I do not want to force people to pass `TypeTable` - this way they are only passing the @model Type name
        const modelTypeName = tableData.tableName.replace('Table', '');
        const streamSpecification = this.props.dynamoDbStreamConfig && this.props.dynamoDbStreamConfig[modelTypeName];
        const tableProps = {
            tableName,
            billingMode: aws_dynamodb_1.BillingMode.PAY_PER_REQUEST,
            partitionKey: {
                name: tableData.partitionKey.name,
                type: this.convertAttributeType(tableData.partitionKey.type),
            },
            pointInTimeRecovery: this.pointInTimeRecovery,
            sortKey: tableData.sortKey && tableData.sortKey.name
                ? {
                    name: tableData.sortKey.name,
                    type: this.convertAttributeType(tableData.sortKey.type),
                } : undefined,
            timeToLiveAttribute: ((_b = tableData === null || tableData === void 0 ? void 0 : tableData.ttl) === null || _b === void 0 ? void 0 : _b.enabled) ? tableData.ttl.attributeName : undefined,
            stream: streamSpecification,
        };
        const table = new aws_dynamodb_1.Table(this.nestedAppsyncStack, tableData.tableName, tableProps);
        tableData.localSecondaryIndexes.forEach((lsi) => {
            table.addLocalSecondaryIndex({
                indexName: lsi.indexName,
                sortKey: {
                    name: lsi.sortKey.name,
                    type: this.convertAttributeType(lsi.sortKey.type),
                },
                projectionType: this.convertProjectionType(lsi.projection.ProjectionType),
            });
        });
        tableData.globalSecondaryIndexes.forEach((gsi) => {
            table.addGlobalSecondaryIndex({
                indexName: gsi.indexName,
                partitionKey: {
                    name: gsi.partitionKey.name,
                    type: this.convertAttributeType(gsi.partitionKey.type),
                },
                sortKey: gsi.sortKey && gsi.sortKey.name
                    ? {
                        name: gsi.sortKey.name,
                        type: this.convertAttributeType(gsi.sortKey.type),
                    } : undefined,
                projectionType: this.convertProjectionType(gsi.projection.ProjectionType),
            });
        });
        return table;
    }
    /**
     * Creates the sync table for Amplify DataStore
     * https://docs.aws.amazon.com/appsync/latest/devguide/conflict-detection-and-sync.html
     * @param tableData The CdkTransformer table information
     */
    createSyncTable(tableData) {
        var _b;
        return new aws_dynamodb_1.Table(this, 'appsync-api-sync-table', {
            billingMode: aws_dynamodb_1.BillingMode.PAY_PER_REQUEST,
            partitionKey: {
                name: tableData.partitionKey.name,
                type: this.convertAttributeType(tableData.partitionKey.type),
            },
            sortKey: {
                name: tableData.sortKey.name,
                type: this.convertAttributeType(tableData.sortKey.type),
            },
            timeToLiveAttribute: ((_b = tableData.ttl) === null || _b === void 0 ? void 0 : _b.attributeName) || '_ttl',
        });
    }
    convertAttributeType(type) {
        switch (type) {
            case 'N':
                return aws_dynamodb_1.AttributeType.NUMBER;
            case 'B':
                return aws_dynamodb_1.AttributeType.BINARY;
            case 'S': // Same as default
            default:
                return aws_dynamodb_1.AttributeType.STRING;
        }
    }
    convertProjectionType(type) {
        switch (type) {
            case 'INCLUDE':
                return aws_dynamodb_1.ProjectionType.INCLUDE;
            case 'KEYS_ONLY':
                return aws_dynamodb_1.ProjectionType.KEYS_ONLY;
            case 'ALL': // Same as default
            default:
                return aws_dynamodb_1.ProjectionType.ALL;
        }
    }
    createHttpResolvers() {
        for (const [endpoint, httpResolvers] of Object.entries(this.httpResolvers)) {
            const strippedEndpoint = endpoint.replace(/[^_0-9A-Za-z]/g, '');
            const httpDataSource = this.appsyncAPI.addHttpDataSource(`${strippedEndpoint}`, endpoint);
            httpResolvers.forEach((resolver) => {
                new aws_appsync_1.Resolver(this.nestedAppsyncStack, `${resolver.typeName}-${resolver.fieldName}-resolver`, {
                    api: this.appsyncAPI,
                    typeName: resolver.typeName,
                    fieldName: resolver.fieldName,
                    dataSource: httpDataSource,
                    requestMappingTemplate: aws_appsync_1.MappingTemplate.fromString(resolver.defaultRequestMappingTemplate),
                    responseMappingTemplate: aws_appsync_1.MappingTemplate.fromString(resolver.defaultResponseMappingTemplate),
                });
            });
        }
    }
    /**
     * This takes one of the autogenerated policies from AWS and builds the list of ARNs for granting GraphQL access later
     * @param policy The auto generated policy from the AppSync Transformers
     * @returns An array of resource arns for use with grants
     */
    getResourcesFromGeneratedRolePolicy(policy) {
        var _b, _c;
        if (!((_c = (_b = policy === null || policy === void 0 ? void 0 : policy.Properties) === null || _b === void 0 ? void 0 : _b.PolicyDocument) === null || _c === void 0 ? void 0 : _c.Statement))
            return [];
        const { region, account } = this.nestedAppsyncStack;
        const resolvedResources = [];
        for (const statement of policy.Properties.PolicyDocument.Statement) {
            const { Resource: resources = [] } = statement !== null && statement !== void 0 ? statement : {};
            for (const resource of resources) {
                const subs = resource['Fn::Sub'][1];
                const { typeName, fieldName } = subs !== null && subs !== void 0 ? subs : {};
                if (fieldName) {
                    resolvedResources.push(`arn:aws:appsync:${region}:${account}:apis/${this.appsyncAPI.apiId}/types/${typeName}/fields/${fieldName}`);
                }
                else {
                    resolvedResources.push(`arn:aws:appsync:${region}:${account}:apis/${this.appsyncAPI.apiId}/types/${typeName}/*`);
                }
            }
        }
        return resolvedResources;
    }
    /**
     * (experimental) Adds the function as a lambdaDataSource to the AppSync api Adds all of the functions resolvers to the AppSync api.
     *
     * @param functionName The function name specified in the.
     * @param id The id to give.
     * @param lambdaFunction The lambda function to attach.
     * @experimental
     * @function directive of the schema
     */
    addLambdaDataSourceAndResolvers(functionName, id, lambdaFunction, options) {
        const functionDataSource = this.appsyncAPI.addLambdaDataSource(id, lambdaFunction, options);
        for (const resolver of this.functionResolvers[functionName]) {
            new aws_appsync_1.Resolver(this.nestedAppsyncStack, `${resolver.typeName}-${resolver.fieldName}-resolver`, {
                api: this.appsyncAPI,
                typeName: resolver.typeName,
                fieldName: resolver.fieldName,
                dataSource: functionDataSource,
                requestMappingTemplate: aws_appsync_1.MappingTemplate.fromString(resolver.defaultRequestMappingTemplate),
                responseMappingTemplate: aws_appsync_1.MappingTemplate.fromString(resolver.defaultResponseMappingTemplate),
            });
        }
        return functionDataSource;
    }
    /**
     * (experimental) Adds a stream to the dynamodb table associated with the type.
     *
     * @returns string - the stream arn token
     * @experimental
     */
    addDynamoDBStream(props) {
        const tableName = `${props.modelTypeName}Table`;
        const table = this.tableMap[tableName];
        if (!table)
            throw new Error(`Table with name '${tableName}' not found.`);
        const cfnTable = table.node.defaultChild;
        cfnTable.streamSpecification = {
            streamViewType: props.streamViewType,
        };
        return cfnTable.attrStreamArn;
    }
    /**
     * (experimental) Adds an IAM policy statement granting access to the public fields of the AppSync API.
     *
     * Policy is based off of the @auth transformer
     * https://docs.amplify.aws/cli/graphql-transformer/auth
     *
     * @param grantee The principal to grant access to.
     * @experimental
     */
    grantPublic(grantee) {
        return aws_iam_1.Grant.addToPrincipal({
            grantee,
            actions: ['appsync:GraphQL'],
            resourceArns: this.publicResourceArns,
            scope: this,
        });
    }
    /**
     * (experimental) Adds an IAM policy statement granting access to the private fields of the AppSync API.
     *
     * Policy is based off of the @auth transformer
     * https://docs.amplify.aws/cli/graphql-transformer/auth
     *
     * @experimental
     */
    grantPrivate(grantee) {
        return aws_iam_1.Grant.addToPrincipal({
            grantee,
            actions: ['appsync:GraphQL'],
            resourceArns: this.privateResourceArns,
        });
    }
}
exports.AppSyncTransformer = AppSyncTransformer;
_a = JSII_RTTI_SYMBOL_1;
AppSyncTransformer[_a] = { fqn: "cdk-appsync-transformer.AppSyncTransformer", version: "1.77.16" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwc3luYy10cmFuc2Zvcm1lci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9hcHBzeW5jLXRyYW5zZm9ybWVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsc0RBWThCO0FBRTlCLHdEQVErQjtBQUMvQiw4Q0FBOEU7QUFFOUUsd0NBQWtFO0FBV2xFLHlFQUcwQztBQWlGMUMsTUFBTSwwQkFBMEIsR0FBd0I7SUFDdEQsb0JBQW9CLEVBQUU7UUFDcEIsaUJBQWlCLEVBQUUsK0JBQWlCLENBQUMsT0FBTztRQUM1QyxZQUFZLEVBQUU7WUFDWixXQUFXLEVBQUUsdUNBQXVDO1lBQ3BELElBQUksRUFBRSxLQUFLO1NBQ1o7S0FDRjtDQUNGLENBQUM7Ozs7OztBQUtGLE1BQWEsa0JBQW1CLFNBQVEsZ0JBQVM7Ozs7SUF5RC9DLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBOEI7O1FBQ3RFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFakIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUM7UUFDbkIsSUFBSSxDQUFDLFFBQVEsR0FBRyxFQUFFLENBQUM7UUFDbkIsSUFBSSxDQUFDLGFBQWEsR0FBRyxFQUFFLENBQUM7UUFDeEIsSUFBSSxDQUFDLGFBQWEsR0FBRyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUM7UUFDbkUsSUFBSSxDQUFDLG1CQUFtQixTQUFHLEtBQUssQ0FBQywrQkFBK0IsbUNBQUksS0FBSyxDQUFDO1FBRTFFLE1BQU0sd0JBQXdCLEdBQTJCO1lBQ3ZELFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVTtZQUM1QixXQUFXLFFBQUUsS0FBSyxDQUFDLFdBQVcsbUNBQUksS0FBSztTQUN4QyxDQUFDO1FBRUYsMENBQTBDO1FBQzFDLDZEQUE2RDtRQUM3RCxNQUFNLHFCQUFxQixHQUFHLENBQUMsU0FB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TSxLQUFLLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUN2QyxJQUFJLENBQUMsS0FBSztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsb0JBQW9CLFNBQVMsY0FBYyxDQUFDLENBQUM7UUFFekUsTUFBTSxRQUFRLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxZQUF3QixDQUFDO1FBQ3JELFFBQVEsQ0FBQyxtQkFBbUIsR0FBRztZQUM3QixjQUFjLEVBQUUsS0FBSyxDQUFDLGNBQWM7U0FDckMsQ0FBQztRQUVGLE9BQU8sUUFBUSxDQUFDLGFBQWEsQ0FBQztJQUNoQyxDQUFDOzs7Ozs7Ozs7O0lBUU0sV0FBVyxDQUFDLE9BQW1CO1FBQ3BDLE9BQU8sZUFBSyxDQUFDLGNBQWMsQ0FBQztZQUMxQixPQUFPO1lBQ1AsT0FBTyxFQUFFLENBQUMsaUJBQWlCLENBQUM7WUFDNUIsWUFBWSxFQUFFLElBQUksQ0FBQyxrQkFBa0I7WUFDckMsS0FBSyxFQUFFLElBQUk7U0FDWixDQUFDLENBQUM7SUFDTCxDQUFDOzs7Ozs7Ozs7SUFRTSxZQUFZLENBQUMsT0FBbUI7UUFDckMsT0FBTyxlQUFLLENBQUMsY0FBYyxDQUFDO1lBQzFCLE9BQU87WUFDUCxPQUFPLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQztZQUM1QixZQUFZLEVBQUUsSUFBSSxDQUFDLG1CQUFtQjtTQUN2QyxDQUFDLENBQUM7SUFDTCxDQUFDOztBQW5qQkgsZ0RBb2pCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIEdyYXBocWxBcGksXG4gIEF1dGhvcml6YXRpb25UeXBlLFxuICBGaWVsZExvZ0xldmVsLFxuICBNYXBwaW5nVGVtcGxhdGUsXG4gIENmbkRhdGFTb3VyY2UsXG4gIFJlc29sdmVyLFxuICBBdXRob3JpemF0aW9uQ29uZmlnLFxuICBTY2hlbWEsXG4gIERhdGFTb3VyY2VPcHRpb25zLFxuICBMYW1iZGFEYXRhU291cmNlLFxuICBEeW5hbW9EYkRhdGFTb3VyY2UsXG59IGZyb20gJ0Bhd3MtY2RrL2F3cy1hcHBzeW5jJztcblxuaW1wb3J0IHtcbiAgQ2ZuVGFibGUsXG4gIFRhYmxlLFxuICBBdHRyaWJ1dGVUeXBlLFxuICBQcm9qZWN0aW9uVHlwZSxcbiAgQmlsbGluZ01vZGUsXG4gIFN0cmVhbVZpZXdUeXBlLFxuICBUYWJsZVByb3BzLFxufSBmcm9tICdAYXdzLWNkay9hd3MtZHluYW1vZGInO1xuaW1wb3J0IHsgRWZmZWN0LCBHcmFudCwgSUdyYW50YWJsZSwgUG9saWN5U3RhdGVtZW50IH0gZnJvbSAnQGF3cy1jZGsvYXdzLWlhbSc7XG5pbXBvcnQgeyBJRnVuY3Rpb24gfSBmcm9tICdAYXdzLWNkay9hd3MtbGFtYmRhJztcbmltcG9ydCB7IENvbnN0cnVjdCwgTmVzdGVkU3RhY2ssIENmbk91dHB1dCB9IGZyb20gJ0Bhd3MtY2RrL2NvcmUnO1xuXG5pbXBvcnQge1xuICBDZGtUcmFuc2Zvcm1lclJlc29sdmVyLFxuICBDZGtUcmFuc2Zvcm1lckZ1bmN0aW9uUmVzb2x2ZXIsXG4gIENka1RyYW5zZm9ybWVySHR0cFJlc29sdmVyLFxuICBDZGtUcmFuc2Zvcm1lclRhYmxlLFxuICBTY2hlbWFUcmFuc2Zvcm1lck91dHB1dHMsXG59IGZyb20gJy4vdHJhbnNmb3JtZXInO1xuaW1wb3J0IHsgUmVzb3VyY2UgfSBmcm9tICcuL3RyYW5zZm9ybWVyL3Jlc291cmNlJztcblxuaW1wb3J0IHtcbiAgU2NoZW1hVHJhbnNmb3JtZXIsXG4gIFNjaGVtYVRyYW5zZm9ybWVyUHJvcHMsXG59IGZyb20gJy4vdHJhbnNmb3JtZXIvc2NoZW1hLXRyYW5zZm9ybWVyJztcblxuZXhwb3J0IGludGVyZmFjZSBBcHBTeW5jVHJhbnNmb3JtZXJQcm9wcyB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IHNjaGVtYVBhdGg6IHN0cmluZztcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSBhdXRob3JpemF0aW9uQ29uZmlnPzogQXV0aG9yaXphdGlvbkNvbmZpZztcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IGFwaU5hbWU/OiBzdHJpbmc7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcmVhZG9ubHkgc3luY0VuYWJsZWQ/OiBib29sZWFuO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IGVuYWJsZUR5bmFtb1BvaW50SW5UaW1lUmVjb3Zlcnk/OiBib29sZWFuO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSBmaWVsZExvZ0xldmVsPzogRmllbGRMb2dMZXZlbDtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSB4cmF5RW5hYmxlZD86IGJvb2xlYW47XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IHRhYmxlTmFtZXM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSBkeW5hbW9EYlN0cmVhbUNvbmZpZz86IHsgW25hbWU6IHN0cmluZ106IFN0cmVhbVZpZXdUeXBlIH07XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcmVhZG9ubHkgbmVzdGVkU3RhY2tOYW1lPzogc3RyaW5nO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG5cbiAgcmVhZG9ubHkgcHJlQ2RrVHJhbnNmb3JtZXJzPzogYW55W107XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuXG4gIHJlYWRvbmx5IHBvc3RDZGtUcmFuc2Zvcm1lcnM/OiBhbnlbXTtcbn1cblxuY29uc3QgZGVmYXVsdEF1dGhvcml6YXRpb25Db25maWc6IEF1dGhvcml6YXRpb25Db25maWcgPSB7XG4gIGRlZmF1bHRBdXRob3JpemF0aW9uOiB7XG4gICAgYXV0aG9yaXphdGlvblR5cGU6IEF1dGhvcml6YXRpb25UeXBlLkFQSV9LRVksXG4gICAgYXBpS2V5Q29uZmlnOiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0F1dG8gZ2VuZXJhdGVkIEFQSSBLZXkgZnJvbSBjb25zdHJ1Y3QnLFxuICAgICAgbmFtZTogJ2RldicsXG4gICAgfSxcbiAgfSxcbn07XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuZXhwb3J0IGNsYXNzIEFwcFN5bmNUcmFuc2Zvcm1lciBleHRlbmRzIENvbnN0cnVjdCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIHJlYWRvbmx5IGFwcHN5bmNBUEk6IEdyYXBocWxBcGk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyByZWFkb25seSBuZXN0ZWRBcHBzeW5jU3RhY2s6IE5lc3RlZFN0YWNrO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyByZWFkb25seSB0YWJsZU5hbWVNYXA6IHsgW25hbWU6IHN0cmluZ106IHN0cmluZyB9O1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICBwdWJsaWMgcmVhZG9ubHkgdGFibGVNYXA6IHsgW25hbWU6IHN0cmluZ106IFRhYmxlIH07XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyByZWFkb25seSBkYXRhc291cmNlTWFwOiB7IFtuYW1lOiBzdHJpbmddOiBEeW5hbW9EYkRhdGFTb3VyY2UgfTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICBwdWJsaWMgcmVhZG9ubHkgb3V0cHV0czogU2NoZW1hVHJhbnNmb3JtZXJPdXRwdXRzO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyByZWFkb25seSByZXNvbHZlcnM6IHsgW25hbWU6IHN0cmluZ106IENka1RyYW5zZm9ybWVyUmVzb2x2ZXIgfTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyByZWFkb25seSBmdW5jdGlvblJlc29sdmVyczoge1xuICAgIFtuYW1lOiBzdHJpbmddOiBDZGtUcmFuc2Zvcm1lckZ1bmN0aW9uUmVzb2x2ZXJbXTtcbiAgfTtcblxuICBwdWJsaWMgcmVhZG9ubHkgaHR0cFJlc29sdmVyczoge1xuICAgIFtuYW1lOiBzdHJpbmddOiBDZGtUcmFuc2Zvcm1lckh0dHBSZXNvbHZlcltdO1xuICB9O1xuXG4gIHByaXZhdGUgcHJvcHM6IEFwcFN5bmNUcmFuc2Zvcm1lclByb3BzXG4gIHByaXZhdGUgaXNTeW5jRW5hYmxlZDogYm9vbGVhbjtcbiAgcHJpdmF0ZSBzeW5jVGFibGU6IFRhYmxlIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHBvaW50SW5UaW1lUmVjb3Zlcnk6IGJvb2xlYW47XG4gIHByaXZhdGUgcmVhZG9ubHkgcHVibGljUmVzb3VyY2VBcm5zOiBzdHJpbmdbXTtcbiAgcHJpdmF0ZSByZWFkb25seSBwcml2YXRlUmVzb3VyY2VBcm5zOiBzdHJpbmdbXTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQXBwU3luY1RyYW5zZm9ybWVyUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgdGhpcy5wcm9wcyA9IHByb3BzO1xuICAgIHRoaXMudGFibGVNYXAgPSB7fTtcbiAgICB0aGlzLmRhdGFzb3VyY2VNYXAgPSB7fTtcbiAgICB0aGlzLmlzU3luY0VuYWJsZWQgPSBwcm9wcy5zeW5jRW5hYmxlZCA/IHByb3BzLnN5bmNFbmFibGVkIDogZmFsc2U7XG4gICAgdGhpcy5wb2ludEluVGltZVJlY292ZXJ5ID0gcHJvcHMuZW5hYmxlRHluYW1vUG9pbnRJblRpbWVSZWNvdmVyeSA/PyBmYWxzZTtcblxuICAgIGNvbnN0IHRyYW5zZm9ybWVyQ29uZmlndXJhdGlvbjogU2NoZW1hVHJhbnNmb3JtZXJQcm9wcyA9IHtcbiAgICAgIHNjaGVtYVBhdGg6IHByb3BzLnNjaGVtYVBhdGgsXG4gICAgICBzeW5jRW5hYmxlZDogcHJvcHMuc3luY0VuYWJsZWQgPz8gZmFsc2UsXG4gICAgfTtcblxuICAgIC8vIENvbWJpbmUgdGhlIGFycmF5cyBzbyB3ZSBvbmx5IGxvb3Agb25jZVxuICAgIC8vIFRlc3QgZWFjaCB0cmFuc2Zvcm1lciB0byBzZWUgaWYgaXQgaW1wbGVtZW50cyBJVHJhbnNmb3JtZXJcbiAgICBjb25zdCBhbGxDdXN0b21UcmFuc2Zvcm1lcnMgPSBbLi4ucHJvcHMucHJlQ2RrVHJhbnNmb3JtZXJzID8/IFtdLCAuLi5wcm9wcy5wb3N0Q2RrVHJhbnNmb3JtZXJzID8/IFtdXTtcbiAgICBpZiAoYWxsQ3VzdG9tVHJhbnNmb3JtZXJzICYmIGFsbEN1c3RvbVRyYW5zZm9ybWVycy5sZW5ndGggPiAwKSB7XG4gICAgICBhbGxDdXN0b21UcmFuc2Zvcm1lcnMuZm9yRWFjaCh0cmFuc2Zvcm1lciA9PiB7XG4gICAgICAgIGlmICh0cmFuc2Zvcm1lciAmJiAhdGhpcy5pbXBsZW1lbnRzSVRyYW5zZm9ybWVyKHRyYW5zZm9ybWVyKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVHJhbnNmb3JtZXIgZG9lcyBub3QgaW1wbGVtZW50IElUcmFuc2Zvcm1lciBmcm9tIGdyYXBocWwtdHJhbnNmb3JtZXItY29yZTogJHt0cmFuc2Zvcm1lcn1gKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgdHJhbnNmb3JtZXIgPSBuZXcgU2NoZW1hVHJhbnNmb3JtZXIodHJhbnNmb3JtZXJDb25maWd1cmF0aW9uKTtcbiAgICB0aGlzLm91dHB1dHMgPSB0cmFuc2Zvcm1lci50cmFuc2Zvcm0ocHJvcHMucHJlQ2RrVHJhbnNmb3JtZXJzLCBwcm9wcy5wb3N0Q2RrVHJhbnNmb3JtZXJzKTtcbiAgICBjb25zdCByZXNvbHZlcnMgPSB0cmFuc2Zvcm1lci5nZXRSZXNvbHZlcnMoKTtcblxuICAgIHRoaXMuZnVuY3Rpb25SZXNvbHZlcnMgPSB0aGlzLm91dHB1dHMuZnVuY3Rpb25SZXNvbHZlcnMgPz8ge307XG5cbiAgICAvLyBSZW1vdmUgYW55IGZ1bmN0aW9uIHJlc29sdmVycyBmcm9tIHRoZSB0b3RhbCBsaXN0IG9mIHJlc29sdmVyc1xuICAgIC8vIE90aGVyd2lzZSBpdCB3aWxsIGFkZCB0aGVtIHR3aWNlXG4gICAgZm9yIChjb25zdCBbXywgZnVuY3Rpb25SZXNvbHZlcnNdIG9mIE9iamVjdC5lbnRyaWVzKFxuICAgICAgdGhpcy5mdW5jdGlvblJlc29sdmVycyxcbiAgICApKSB7XG4gICAgICBmdW5jdGlvblJlc29sdmVycy5mb3JFYWNoKChyZXNvbHZlcikgPT4ge1xuICAgICAgICBzd2l0Y2ggKHJlc29sdmVyLnR5cGVOYW1lKSB7XG4gICAgICAgICAgY2FzZSAnUXVlcnknOlxuICAgICAgICAgIGNhc2UgJ011dGF0aW9uJzpcbiAgICAgICAgICBjYXNlICdTdWJzY3JpcHRpb24nOlxuICAgICAgICAgICAgZGVsZXRlIHJlc29sdmVyc1tyZXNvbHZlci5maWVsZE5hbWVdO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHRoaXMuaHR0cFJlc29sdmVycyA9IHRoaXMub3V0cHV0cy5odHRwUmVzb2x2ZXJzID8/IHt9O1xuXG4gICAgLy8gUmVtb3ZlIGFueSBodHRwIHJlc29sdmVycyBmcm9tIHRoZSB0b3RhbCBsaXN0IG9mIHJlc29sdmVyc1xuICAgIC8vIE90aGVyd2lzZSBpdCB3aWxsIGFkZCB0aGVtIHR3aWNlXG4gICAgZm9yIChjb25zdCBbXywgaHR0cFJlc29sdmVyc10gb2YgT2JqZWN0LmVudHJpZXModGhpcy5odHRwUmVzb2x2ZXJzKSkge1xuICAgICAgaHR0cFJlc29sdmVycy5mb3JFYWNoKChyZXNvbHZlcikgPT4ge1xuICAgICAgICBzd2l0Y2ggKHJlc29sdmVyLnR5cGVOYW1lKSB7XG4gICAgICAgICAgY2FzZSAnUXVlcnknOlxuICAgICAgICAgIGNhc2UgJ011dGF0aW9uJzpcbiAgICAgICAgICBjYXNlICdTdWJzY3JpcHRpb24nOlxuICAgICAgICAgICAgZGVsZXRlIHJlc29sdmVyc1tyZXNvbHZlci5maWVsZE5hbWVdO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHRoaXMucmVzb2x2ZXJzID0gcmVzb2x2ZXJzO1xuXG4gICAgdGhpcy5uZXN0ZWRBcHBzeW5jU3RhY2sgPSBuZXcgTmVzdGVkU3RhY2sodGhpcywgcHJvcHMubmVzdGVkU3RhY2tOYW1lID8/ICdhcHBzeW5jLW5lc3RlZC1zdGFjaycpO1xuXG4gICAgLy8gQXBwU3luY1xuICAgIHRoaXMuYXBwc3luY0FQSSA9IG5ldyBHcmFwaHFsQXBpKHRoaXMubmVzdGVkQXBwc3luY1N0YWNrLCBgJHtpZH0tYXBpYCwge1xuICAgICAgbmFtZTogcHJvcHMuYXBpTmFtZSA/IHByb3BzLmFwaU5hbWUgOiBgJHtpZH0tYXBpYCxcbiAgICAgIGF1dGhvcml6YXRpb25Db25maWc6IHByb3BzLmF1dGhvcml6YXRpb25Db25maWdcbiAgICAgICAgPyBwcm9wcy5hdXRob3JpemF0aW9uQ29uZmlnXG4gICAgICAgIDogZGVmYXVsdEF1dGhvcml6YXRpb25Db25maWcsXG4gICAgICBsb2dDb25maWc6IHtcbiAgICAgICAgZmllbGRMb2dMZXZlbDogcHJvcHMuZmllbGRMb2dMZXZlbFxuICAgICAgICAgID8gcHJvcHMuZmllbGRMb2dMZXZlbFxuICAgICAgICAgIDogRmllbGRMb2dMZXZlbC5OT05FLFxuICAgICAgfSxcbiAgICAgIHNjaGVtYTogU2NoZW1hLmZyb21Bc3NldCgnLi9hcHBzeW5jL3NjaGVtYS5ncmFwaHFsJyksXG4gICAgICB4cmF5RW5hYmxlZDogcHJvcHMueHJheUVuYWJsZWQgPz8gZmFsc2UsXG4gICAgfSk7XG5cbiAgICBsZXQgdGFibGVEYXRhID0gdGhpcy5vdXRwdXRzLmNka1RhYmxlcyA/PyB7fTtcblxuICAgIC8vIENoZWNrIHRvIHNlZSBpZiBzeW5jIGlzIGVuYWJsZWRcbiAgICBpZiAodGFibGVEYXRhLkRhdGFTdG9yZSkge1xuICAgICAgdGhpcy5pc1N5bmNFbmFibGVkID0gdHJ1ZTtcbiAgICAgIHRoaXMuc3luY1RhYmxlID0gdGhpcy5jcmVhdGVTeW5jVGFibGUodGFibGVEYXRhLkRhdGFTdG9yZSk7XG4gICAgICBkZWxldGUgdGFibGVEYXRhLkRhdGFTdG9yZTsgLy8gV2UgZG9uJ3Qgd2FudCB0byBjcmVhdGUgdGhpcyBhZ2FpbiBiZWxvdyBzbyByZW1vdmUgaXQgZnJvbSB0aGUgdGFibGVEYXRhIG1hcFxuICAgIH1cblxuICAgIHRoaXMudGFibGVOYW1lTWFwID0gdGhpcy5jcmVhdGVUYWJsZXNBbmRSZXNvbHZlcnModGFibGVEYXRhLCByZXNvbHZlcnMsIHByb3BzLnRhYmxlTmFtZXMpO1xuICAgIGlmICh0aGlzLm91dHB1dHMubm9uZVJlc29sdmVycykge1xuICAgICAgdGhpcy5jcmVhdGVOb25lRGF0YVNvdXJjZUFuZFJlc29sdmVycyhcbiAgICAgICAgdGhpcy5vdXRwdXRzLm5vbmVSZXNvbHZlcnMsXG4gICAgICAgIHJlc29sdmVycyxcbiAgICAgICk7XG4gICAgfVxuICAgIHRoaXMuY3JlYXRlSHR0cFJlc29sdmVycygpO1xuXG4gICAgdGhpcy5wdWJsaWNSZXNvdXJjZUFybnMgPSB0aGlzLmdldFJlc291cmNlc0Zyb21HZW5lcmF0ZWRSb2xlUG9saWN5KHRyYW5zZm9ybWVyLnVuYXV0aFJvbGVQb2xpY3kpO1xuICAgIHRoaXMucHJpdmF0ZVJlc291cmNlQXJucyA9IHRoaXMuZ2V0UmVzb3VyY2VzRnJvbUdlbmVyYXRlZFJvbGVQb2xpY3kodHJhbnNmb3JtZXIuYXV0aFJvbGVQb2xpY3kpO1xuXG4gICAgLy8gT3V0cHV0cyBzbyB3ZSBjYW4gZ2VuZXJhdGUgZXhwb3J0c1xuICAgIG5ldyBDZm5PdXRwdXQoc2NvcGUsICdhcHBzeW5jR3JhcGhRTEVuZHBvaW50T3V0cHV0Jywge1xuICAgICAgdmFsdWU6IHRoaXMuYXBwc3luY0FQSS5ncmFwaHFsVXJsLFxuICAgICAgZGVzY3JpcHRpb246ICdPdXRwdXQgZm9yIGF3c19hcHBzeW5jX2dyYXBocWxFbmRwb2ludCcsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogZ3JhcGhxbC10cmFuc2Zvcm1lci1jb3JlIG5lZWRzIHRvIGJlIGpzaWkgZW5hYmxlZCB0byBwdWxsIHRoZSBJVHJhbnNmb3JtZXIgaW50ZXJmYWNlIGNvcnJlY3RseS5cbiAgICogU2luY2UgaXQncyBub3QgaW4gcGVlciBkZXBlbmRlbmNpZXMgaXQgZG9lc24ndCBzaG93IHVwIGluIHRoZSBqc2lpIGRlcHMgbGlzdC5cbiAgICogU2luY2UgaXQncyBub3QganNpaSBlbmFibGVkIGl0IGhhcyB0byBiZSBidW5kbGVkLlxuICAgKiBUaGUgcGFja2FnZSBjYW4ndCBiZSBpbiBCT1RIIHBlZXIgYW5kIGJ1bmRsZWQgZGVwZW5kZW5jaWVzXG4gICAqIFNvIHdlIGRvIGEgZmFrZSB0ZXN0IHRvIG1ha2Ugc3VyZSBpdCBpbXBsZW1lbnRzIHRoZXNlIGFuZCBob3BlIGZvciB0aGUgYmVzdFxuICAgKiBAcGFyYW0gdHJhbnNmb3JtZXJcbiAgICovXG4gIHByaXZhdGUgaW1wbGVtZW50c0lUcmFuc2Zvcm1lcih0cmFuc2Zvcm1lcjogYW55KSB7XG4gICAgcmV0dXJuICduYW1lJyBpbiB0cmFuc2Zvcm1lclxuICAgICAgJiYgJ2RpcmVjdGl2ZScgaW4gdHJhbnNmb3JtZXJcbiAgICAgICYmICd0eXBlRGVmaW5pdGlvbnMnIGluIHRyYW5zZm9ybWVyO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgTk9ORSBkYXRhIHNvdXJjZSBhbmQgYXNzb2NpYXRlZCByZXNvbHZlcnNcbiAgICogQHBhcmFtIG5vbmVSZXNvbHZlcnMgVGhlIHJlc29sdmVycyB0aGF0IGJlbG9uZyB0byB0aGUgbm9uZSBkYXRhIHNvdXJjZVxuICAgKiBAcGFyYW0gcmVzb2x2ZXJzIFRoZSByZXNvbHZlciBtYXAgbWludXMgZnVuY3Rpb24gcmVzb2x2ZXJzXG4gICAqL1xuICBwcml2YXRlIGNyZWF0ZU5vbmVEYXRhU291cmNlQW5kUmVzb2x2ZXJzKFxuICAgIG5vbmVSZXNvbHZlcnM6IHsgW25hbWU6IHN0cmluZ106IENka1RyYW5zZm9ybWVyUmVzb2x2ZXIgfSxcbiAgICByZXNvbHZlcnM6IGFueSxcbiAgKSB7XG4gICAgY29uc3Qgbm9uZURhdGFTb3VyY2UgPSB0aGlzLmFwcHN5bmNBUEkuYWRkTm9uZURhdGFTb3VyY2UoJ05PTkUnKTtcblxuICAgIE9iamVjdC5rZXlzKG5vbmVSZXNvbHZlcnMpLmZvckVhY2goKHJlc29sdmVyS2V5KSA9PiB7XG4gICAgICBjb25zdCByZXNvbHZlciA9IHJlc29sdmVyc1tyZXNvbHZlcktleV07XG4gICAgICBuZXcgUmVzb2x2ZXIoXG4gICAgICAgIHRoaXMubmVzdGVkQXBwc3luY1N0YWNrLFxuICAgICAgICBgJHtyZXNvbHZlci50eXBlTmFtZX0tJHtyZXNvbHZlci5maWVsZE5hbWV9LXJlc29sdmVyYCxcbiAgICAgICAge1xuICAgICAgICAgIGFwaTogdGhpcy5hcHBzeW5jQVBJLFxuICAgICAgICAgIHR5cGVOYW1lOiByZXNvbHZlci50eXBlTmFtZSxcbiAgICAgICAgICBmaWVsZE5hbWU6IHJlc29sdmVyLmZpZWxkTmFtZSxcbiAgICAgICAgICBkYXRhU291cmNlOiBub25lRGF0YVNvdXJjZSxcbiAgICAgICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBNYXBwaW5nVGVtcGxhdGUuZnJvbUZpbGUoXG4gICAgICAgICAgICByZXNvbHZlci5yZXF1ZXN0TWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICksXG4gICAgICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IE1hcHBpbmdUZW1wbGF0ZS5mcm9tRmlsZShcbiAgICAgICAgICAgIHJlc29sdmVyLnJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICksXG4gICAgICAgIH0sXG4gICAgICApO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgZWFjaCBkeW5hbW9kYiB0YWJsZSwgZ3NpcywgZHluYW1vZGIgZGF0YXNvdXJjZSwgYW5kIGFzc29jaWF0ZWQgcmVzb2x2ZXJzXG4gICAqIElmIHN5bmMgaXMgZW5hYmxlZCB0aGVuIFRUTCBjb25maWd1cmF0aW9uIGlzIGFkZGVkXG4gICAqIFJldHVybnMgdGFibGVOYW1lOiB0YWJsZSBtYXAgaW4gY2FzZSBpdCBpcyBuZWVkZWQgZm9yIGxhbWJkYSBmdW5jdGlvbnMsIGV0Y1xuICAgKiBAcGFyYW0gdGFibGVEYXRhIFRoZSBDZGtUcmFuc2Zvcm1lciB0YWJsZSBpbmZvcm1hdGlvblxuICAgKiBAcGFyYW0gcmVzb2x2ZXJzIFRoZSByZXNvbHZlciBtYXAgbWludXMgZnVuY3Rpb24gcmVzb2x2ZXJzXG4gICAqL1xuICBwcml2YXRlIGNyZWF0ZVRhYmxlc0FuZFJlc29sdmVycyhcbiAgICB0YWJsZURhdGE6IHsgW25hbWU6IHN0cmluZ106IENka1RyYW5zZm9ybWVyVGFibGUgfSxcbiAgICByZXNvbHZlcnM6IGFueSxcbiAgICB0YWJsZU5hbWVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge30sXG4gICk6IHsgW25hbWU6IHN0cmluZ106IHN0cmluZyB9IHtcbiAgICBjb25zdCB0YWJsZU5hbWVNYXA6IGFueSA9IHt9O1xuXG4gICAgT2JqZWN0LmtleXModGFibGVEYXRhKS5mb3JFYWNoKCh0YWJsZUtleSkgPT4ge1xuICAgICAgY29uc3QgdGFibGVOYW1lID0gdGFibGVOYW1lc1t0YWJsZUtleV0gPz8gdW5kZWZpbmVkO1xuICAgICAgY29uc3QgdGFibGUgPSB0aGlzLmNyZWF0ZVRhYmxlKHRhYmxlRGF0YVt0YWJsZUtleV0sIHRhYmxlTmFtZSk7XG4gICAgICB0aGlzLnRhYmxlTWFwW3RhYmxlS2V5XSA9IHRhYmxlO1xuXG4gICAgICBjb25zdCBkYXRhU291cmNlID0gdGhpcy5hcHBzeW5jQVBJLmFkZER5bmFtb0RiRGF0YVNvdXJjZSh0YWJsZUtleSwgdGFibGUpO1xuXG4gICAgICAvLyBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vQVdTQ2xvdWRGb3JtYXRpb24vbGF0ZXN0L1VzZXJHdWlkZS9hd3MtcHJvcGVydGllcy1hcHBzeW5jLWRhdGFzb3VyY2UtZGVsdGFzeW5jY29uZmlnLmh0bWxcblxuICAgICAgaWYgKHRoaXMuaXNTeW5jRW5hYmxlZCAmJiB0aGlzLnN5bmNUYWJsZSkge1xuICAgICAgICAvL0B0cy1pZ25vcmUgLSBkcyBpcyB0aGUgYmFzZSBDZm5EYXRhU291cmNlIGFuZCB0aGUgZGIgY29uZmlnIG5lZWRzIHRvIGJlIHZlcnNpb25lZCAtIHNlZSBDZm5EYXRhU291cmNlXG4gICAgICAgIGRhdGFTb3VyY2UuZHMuZHluYW1vRGJDb25maWcudmVyc2lvbmVkID0gdHJ1ZTtcblxuICAgICAgICAvL0B0cy1pZ25vcmUgLSBkcyBpcyB0aGUgYmFzZSBDZm5EYXRhU291cmNlIC0gc2VlIENmbkRhdGFTb3VyY2VcbiAgICAgICAgZGF0YVNvdXJjZS5kcy5keW5hbW9EYkNvbmZpZy5kZWx0YVN5bmNDb25maWcgPSB7XG4gICAgICAgICAgYmFzZVRhYmxlVHRsOiAnNDMyMDAnLCAvLyBHb3QgdGhpcyB2YWx1ZSBmcm9tIGFtcGxpZnkgLSAzMCBkYXlzIGluIG1pbnV0ZXNcbiAgICAgICAgICBkZWx0YVN5bmNUYWJsZU5hbWU6IHRoaXMuc3luY1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgICBkZWx0YVN5bmNUYWJsZVR0bDogJzMwJywgLy8gR290IHRoaXMgdmFsdWUgZnJvbSBhbXBsaWZ5IC0gMzAgbWludXRlc1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIE5lZWQgdG8gYWRkIHBlcm1pc3Npb24gZm9yIG91ciBkYXRhc291cmNlIHNlcnZpY2Ugcm9sZSB0byBhY2Nlc3MgdGhlIHN5bmMgdGFibGVcbiAgICAgICAgZGF0YVNvdXJjZS5ncmFudFByaW5jaXBhbC5hZGRUb1BvbGljeShcbiAgICAgICAgICBuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAnZHluYW1vZGI6KicsIC8vIFRPRE86IFRoaXMgbWF5IGJlIHRvbyBwZXJtaXNzaXZlXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy5zeW5jVGFibGUudGFibGVBcm5dLFxuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBkeW5hbW9EYkNvbmZpZyA9IGRhdGFTb3VyY2UuZHNcbiAgICAgICAgLmR5bmFtb0RiQ29uZmlnIGFzIENmbkRhdGFTb3VyY2UuRHluYW1vREJDb25maWdQcm9wZXJ0eTtcbiAgICAgIHRhYmxlTmFtZU1hcFt0YWJsZUtleV0gPSBkeW5hbW9EYkNvbmZpZy50YWJsZU5hbWU7XG5cbiAgICAgIC8vRXhwb3NlIGRhdGFzb3VyY2UgdG8gc3VwcG9ydCBhZGRpbmcgbXVsdGlwbGUgcmVzb2x2ZXJzXG4gICAgICB0aGlzLmRhdGFzb3VyY2VNYXBbdGFibGVLZXldID0gZGF0YVNvdXJjZTtcblxuXG4gICAgICAvLyBMb29wIHRoZSBiYXNpYyByZXNvbHZlcnNcbiAgICAgIHRhYmxlRGF0YVt0YWJsZUtleV0ucmVzb2x2ZXJzLmZvckVhY2goKHJlc29sdmVyS2V5KSA9PiB7XG4gICAgICAgIGxldCByZXNvbHZlciA9IHJlc29sdmVyc1tyZXNvbHZlcktleV07XG4gICAgICAgIG5ldyBSZXNvbHZlcihcbiAgICAgICAgICB0aGlzLm5lc3RlZEFwcHN5bmNTdGFjayxcbiAgICAgICAgICBgJHtyZXNvbHZlci50eXBlTmFtZX0tJHtyZXNvbHZlci5maWVsZE5hbWV9LXJlc29sdmVyYCxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBhcGk6IHRoaXMuYXBwc3luY0FQSSxcbiAgICAgICAgICAgIHR5cGVOYW1lOiByZXNvbHZlci50eXBlTmFtZSxcbiAgICAgICAgICAgIGZpZWxkTmFtZTogcmVzb2x2ZXIuZmllbGROYW1lLFxuICAgICAgICAgICAgZGF0YVNvdXJjZTogZGF0YVNvdXJjZSxcbiAgICAgICAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IE1hcHBpbmdUZW1wbGF0ZS5mcm9tRmlsZShcbiAgICAgICAgICAgICAgcmVzb2x2ZXIucmVxdWVzdE1hcHBpbmdUZW1wbGF0ZSxcbiAgICAgICAgICAgICksXG4gICAgICAgICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogTWFwcGluZ1RlbXBsYXRlLmZyb21GaWxlKFxuICAgICAgICAgICAgICByZXNvbHZlci5yZXNwb25zZU1hcHBpbmdUZW1wbGF0ZSxcbiAgICAgICAgICAgICksXG4gICAgICAgICAgfSxcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBMb29wIHRoZSBnc2kgcmVzb2x2ZXJzXG4gICAgICB0YWJsZURhdGFbdGFibGVLZXldLmdzaVJlc29sdmVycy5mb3JFYWNoKChyZXNvbHZlcktleSkgPT4ge1xuICAgICAgICBsZXQgcmVzb2x2ZXIgPSByZXNvbHZlcnMuZ3NpW3Jlc29sdmVyS2V5XTtcbiAgICAgICAgbmV3IFJlc29sdmVyKFxuICAgICAgICAgIHRoaXMubmVzdGVkQXBwc3luY1N0YWNrLFxuICAgICAgICAgIGAke3Jlc29sdmVyLnR5cGVOYW1lfS0ke3Jlc29sdmVyLmZpZWxkTmFtZX0tcmVzb2x2ZXJgLFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGFwaTogdGhpcy5hcHBzeW5jQVBJLFxuICAgICAgICAgICAgdHlwZU5hbWU6IHJlc29sdmVyLnR5cGVOYW1lLFxuICAgICAgICAgICAgZmllbGROYW1lOiByZXNvbHZlci5maWVsZE5hbWUsXG4gICAgICAgICAgICBkYXRhU291cmNlOiBkYXRhU291cmNlLFxuICAgICAgICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogTWFwcGluZ1RlbXBsYXRlLmZyb21GaWxlKFxuICAgICAgICAgICAgICByZXNvbHZlci5yZXF1ZXN0TWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBNYXBwaW5nVGVtcGxhdGUuZnJvbUZpbGUoXG4gICAgICAgICAgICAgIHJlc29sdmVyLnJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICB9LFxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdGFibGVOYW1lTWFwO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVUYWJsZSh0YWJsZURhdGE6IENka1RyYW5zZm9ybWVyVGFibGUsIHRhYmxlTmFtZT86IHN0cmluZykge1xuICAgIC8vIEkgZG8gbm90IHdhbnQgdG8gZm9yY2UgcGVvcGxlIHRvIHBhc3MgYFR5cGVUYWJsZWAgLSB0aGlzIHdheSB0aGV5IGFyZSBvbmx5IHBhc3NpbmcgdGhlIEBtb2RlbCBUeXBlIG5hbWVcbiAgICBjb25zdCBtb2RlbFR5cGVOYW1lID0gdGFibGVEYXRhLnRhYmxlTmFtZS5yZXBsYWNlKCdUYWJsZScsICcnKTtcbiAgICBjb25zdCBzdHJlYW1TcGVjaWZpY2F0aW9uID0gdGhpcy5wcm9wcy5keW5hbW9EYlN0cmVhbUNvbmZpZyAmJiB0aGlzLnByb3BzLmR5bmFtb0RiU3RyZWFtQ29uZmlnW21vZGVsVHlwZU5hbWVdO1xuICAgIGNvbnN0IHRhYmxlUHJvcHM6IFRhYmxlUHJvcHMgPSB7XG4gICAgICB0YWJsZU5hbWUsXG4gICAgICBiaWxsaW5nTW9kZTogQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgcGFydGl0aW9uS2V5OiB7XG4gICAgICAgIG5hbWU6IHRhYmxlRGF0YS5wYXJ0aXRpb25LZXkubmFtZSxcbiAgICAgICAgdHlwZTogdGhpcy5jb252ZXJ0QXR0cmlidXRlVHlwZSh0YWJsZURhdGEucGFydGl0aW9uS2V5LnR5cGUpLFxuICAgICAgfSxcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRoaXMucG9pbnRJblRpbWVSZWNvdmVyeSxcbiAgICAgIHNvcnRLZXk6IHRhYmxlRGF0YS5zb3J0S2V5ICYmIHRhYmxlRGF0YS5zb3J0S2V5Lm5hbWVcbiAgICAgICAgPyB7XG4gICAgICAgICAgbmFtZTogdGFibGVEYXRhLnNvcnRLZXkubmFtZSxcbiAgICAgICAgICB0eXBlOiB0aGlzLmNvbnZlcnRBdHRyaWJ1dGVUeXBlKHRhYmxlRGF0YS5zb3J0S2V5LnR5cGUpLFxuICAgICAgICB9IDogdW5kZWZpbmVkLFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogdGFibGVEYXRhPy50dGw/LmVuYWJsZWQgPyB0YWJsZURhdGEudHRsLmF0dHJpYnV0ZU5hbWUgOiB1bmRlZmluZWQsXG4gICAgICBzdHJlYW06IHN0cmVhbVNwZWNpZmljYXRpb24sXG4gICAgfTtcblxuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlKFxuICAgICAgdGhpcy5uZXN0ZWRBcHBzeW5jU3RhY2ssXG4gICAgICB0YWJsZURhdGEudGFibGVOYW1lLFxuICAgICAgdGFibGVQcm9wcyxcbiAgICApO1xuXG4gICAgdGFibGVEYXRhLmxvY2FsU2Vjb25kYXJ5SW5kZXhlcy5mb3JFYWNoKChsc2kpID0+IHtcbiAgICAgIHRhYmxlLmFkZExvY2FsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgICBpbmRleE5hbWU6IGxzaS5pbmRleE5hbWUsXG4gICAgICAgIHNvcnRLZXk6IHtcbiAgICAgICAgICBuYW1lOiBsc2kuc29ydEtleS5uYW1lLFxuICAgICAgICAgIHR5cGU6IHRoaXMuY29udmVydEF0dHJpYnV0ZVR5cGUobHNpLnNvcnRLZXkudHlwZSksXG4gICAgICAgIH0sXG4gICAgICAgIHByb2plY3Rpb25UeXBlOiB0aGlzLmNvbnZlcnRQcm9qZWN0aW9uVHlwZShcbiAgICAgICAgICBsc2kucHJvamVjdGlvbi5Qcm9qZWN0aW9uVHlwZSxcbiAgICAgICAgKSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgdGFibGVEYXRhLmdsb2JhbFNlY29uZGFyeUluZGV4ZXMuZm9yRWFjaCgoZ3NpKSA9PiB7XG4gICAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICAgIGluZGV4TmFtZTogZ3NpLmluZGV4TmFtZSxcbiAgICAgICAgcGFydGl0aW9uS2V5OiB7XG4gICAgICAgICAgbmFtZTogZ3NpLnBhcnRpdGlvbktleS5uYW1lLFxuICAgICAgICAgIHR5cGU6IHRoaXMuY29udmVydEF0dHJpYnV0ZVR5cGUoZ3NpLnBhcnRpdGlvbktleS50eXBlKSxcbiAgICAgICAgfSxcbiAgICAgICAgc29ydEtleTogZ3NpLnNvcnRLZXkgJiYgZ3NpLnNvcnRLZXkubmFtZVxuICAgICAgICAgID8ge1xuICAgICAgICAgICAgbmFtZTogZ3NpLnNvcnRLZXkubmFtZSxcbiAgICAgICAgICAgIHR5cGU6IHRoaXMuY29udmVydEF0dHJpYnV0ZVR5cGUoZ3NpLnNvcnRLZXkudHlwZSksXG4gICAgICAgICAgfSA6IHVuZGVmaW5lZCxcbiAgICAgICAgcHJvamVjdGlvblR5cGU6IHRoaXMuY29udmVydFByb2plY3Rpb25UeXBlKFxuICAgICAgICAgIGdzaS5wcm9qZWN0aW9uLlByb2plY3Rpb25UeXBlLFxuICAgICAgICApLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdGFibGU7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyB0aGUgc3luYyB0YWJsZSBmb3IgQW1wbGlmeSBEYXRhU3RvcmVcbiAgICogaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL2FwcHN5bmMvbGF0ZXN0L2Rldmd1aWRlL2NvbmZsaWN0LWRldGVjdGlvbi1hbmQtc3luYy5odG1sXG4gICAqIEBwYXJhbSB0YWJsZURhdGEgVGhlIENka1RyYW5zZm9ybWVyIHRhYmxlIGluZm9ybWF0aW9uXG4gICAqL1xuICBwcml2YXRlIGNyZWF0ZVN5bmNUYWJsZSh0YWJsZURhdGE6IENka1RyYW5zZm9ybWVyVGFibGUpOiBUYWJsZSB7XG4gICAgcmV0dXJuIG5ldyBUYWJsZSh0aGlzLCAnYXBwc3luYy1hcGktc3luYy10YWJsZScsIHtcbiAgICAgIGJpbGxpbmdNb2RlOiBCaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogdGFibGVEYXRhLnBhcnRpdGlvbktleS5uYW1lLFxuICAgICAgICB0eXBlOiB0aGlzLmNvbnZlcnRBdHRyaWJ1dGVUeXBlKHRhYmxlRGF0YS5wYXJ0aXRpb25LZXkudHlwZSksXG4gICAgICB9LFxuICAgICAgc29ydEtleToge1xuICAgICAgICBuYW1lOiB0YWJsZURhdGEuc29ydEtleSEubmFtZSwgLy8gV2Uga25vdyBpdCBoYXMgYSBzb3J0a2V5IGJlY2F1c2Ugd2UgZm9yY2VkIGl0IHRvXG4gICAgICAgIHR5cGU6IHRoaXMuY29udmVydEF0dHJpYnV0ZVR5cGUodGFibGVEYXRhLnNvcnRLZXkhLnR5cGUpLCAvLyBXZSBrbm93IGl0IGhhcyBhIHNvcnRrZXkgYmVjYXVzZSB3ZSBmb3JjZWQgaXQgdG9cbiAgICAgIH0sXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiB0YWJsZURhdGEudHRsPy5hdHRyaWJ1dGVOYW1lIHx8ICdfdHRsJyxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgY29udmVydEF0dHJpYnV0ZVR5cGUodHlwZTogc3RyaW5nKTogQXR0cmlidXRlVHlwZSB7XG4gICAgc3dpdGNoICh0eXBlKSB7XG4gICAgICBjYXNlICdOJzpcbiAgICAgICAgcmV0dXJuIEF0dHJpYnV0ZVR5cGUuTlVNQkVSO1xuICAgICAgY2FzZSAnQic6XG4gICAgICAgIHJldHVybiBBdHRyaWJ1dGVUeXBlLkJJTkFSWTtcbiAgICAgIGNhc2UgJ1MnOiAvLyBTYW1lIGFzIGRlZmF1bHRcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiBBdHRyaWJ1dGVUeXBlLlNUUklORztcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGNvbnZlcnRQcm9qZWN0aW9uVHlwZSh0eXBlOiBzdHJpbmcpOiBQcm9qZWN0aW9uVHlwZSB7XG4gICAgc3dpdGNoICh0eXBlKSB7XG4gICAgICBjYXNlICdJTkNMVURFJzpcbiAgICAgICAgcmV0dXJuIFByb2plY3Rpb25UeXBlLklOQ0xVREU7XG4gICAgICBjYXNlICdLRVlTX09OTFknOlxuICAgICAgICByZXR1cm4gUHJvamVjdGlvblR5cGUuS0VZU19PTkxZO1xuICAgICAgY2FzZSAnQUxMJzogLy8gU2FtZSBhcyBkZWZhdWx0XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4gUHJvamVjdGlvblR5cGUuQUxMO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlSHR0cFJlc29sdmVycygpIHtcbiAgICBmb3IgKGNvbnN0IFtlbmRwb2ludCwgaHR0cFJlc29sdmVyc10gb2YgT2JqZWN0LmVudHJpZXMoXG4gICAgICB0aGlzLmh0dHBSZXNvbHZlcnMsXG4gICAgKSkge1xuICAgICAgY29uc3Qgc3RyaXBwZWRFbmRwb2ludCA9IGVuZHBvaW50LnJlcGxhY2UoL1teXzAtOUEtWmEtel0vZywgJycpO1xuICAgICAgY29uc3QgaHR0cERhdGFTb3VyY2UgPSB0aGlzLmFwcHN5bmNBUEkuYWRkSHR0cERhdGFTb3VyY2UoXG4gICAgICAgIGAke3N0cmlwcGVkRW5kcG9pbnR9YCxcbiAgICAgICAgZW5kcG9pbnQsXG4gICAgICApO1xuXG4gICAgICBodHRwUmVzb2x2ZXJzLmZvckVhY2goKHJlc29sdmVyOiBDZGtUcmFuc2Zvcm1lckh0dHBSZXNvbHZlcikgPT4ge1xuICAgICAgICBuZXcgUmVzb2x2ZXIoXG4gICAgICAgICAgdGhpcy5uZXN0ZWRBcHBzeW5jU3RhY2ssXG4gICAgICAgICAgYCR7cmVzb2x2ZXIudHlwZU5hbWV9LSR7cmVzb2x2ZXIuZmllbGROYW1lfS1yZXNvbHZlcmAsXG4gICAgICAgICAge1xuICAgICAgICAgICAgYXBpOiB0aGlzLmFwcHN5bmNBUEksXG4gICAgICAgICAgICB0eXBlTmFtZTogcmVzb2x2ZXIudHlwZU5hbWUsXG4gICAgICAgICAgICBmaWVsZE5hbWU6IHJlc29sdmVyLmZpZWxkTmFtZSxcbiAgICAgICAgICAgIGRhdGFTb3VyY2U6IGh0dHBEYXRhU291cmNlLFxuICAgICAgICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoXG4gICAgICAgICAgICAgIHJlc29sdmVyLmRlZmF1bHRSZXF1ZXN0TWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBNYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhcbiAgICAgICAgICAgICAgcmVzb2x2ZXIuZGVmYXVsdFJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICB9LFxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRoaXMgdGFrZXMgb25lIG9mIHRoZSBhdXRvZ2VuZXJhdGVkIHBvbGljaWVzIGZyb20gQVdTIGFuZCBidWlsZHMgdGhlIGxpc3Qgb2YgQVJOcyBmb3IgZ3JhbnRpbmcgR3JhcGhRTCBhY2Nlc3MgbGF0ZXJcbiAgICogQHBhcmFtIHBvbGljeSBUaGUgYXV0byBnZW5lcmF0ZWQgcG9saWN5IGZyb20gdGhlIEFwcFN5bmMgVHJhbnNmb3JtZXJzXG4gICAqIEByZXR1cm5zIEFuIGFycmF5IG9mIHJlc291cmNlIGFybnMgZm9yIHVzZSB3aXRoIGdyYW50c1xuICAgKi9cbiAgcHJpdmF0ZSBnZXRSZXNvdXJjZXNGcm9tR2VuZXJhdGVkUm9sZVBvbGljeShwb2xpY3k/OiBSZXNvdXJjZSk6IHN0cmluZ1tdIHtcbiAgICBpZiAoIXBvbGljeT8uUHJvcGVydGllcz8uUG9saWN5RG9jdW1lbnQ/LlN0YXRlbWVudCkgcmV0dXJuIFtdO1xuXG4gICAgY29uc3QgeyByZWdpb24sIGFjY291bnQgfSA9IHRoaXMubmVzdGVkQXBwc3luY1N0YWNrO1xuXG4gICAgY29uc3QgcmVzb2x2ZWRSZXNvdXJjZXM6IHN0cmluZ1tdID0gW107XG4gICAgZm9yIChjb25zdCBzdGF0ZW1lbnQgb2YgcG9saWN5LlByb3BlcnRpZXMuUG9saWN5RG9jdW1lbnQuU3RhdGVtZW50KSB7XG4gICAgICBjb25zdCB7IFJlc291cmNlOiByZXNvdXJjZXMgPSBbXSB9ID0gc3RhdGVtZW50ID8/IHt9O1xuICAgICAgZm9yIChjb25zdCByZXNvdXJjZSBvZiByZXNvdXJjZXMpIHtcbiAgICAgICAgY29uc3Qgc3VicyA9IHJlc291cmNlWydGbjo6U3ViJ11bMV07XG4gICAgICAgIGNvbnN0IHsgdHlwZU5hbWUsIGZpZWxkTmFtZSB9ID0gc3VicyA/PyB7fTtcbiAgICAgICAgaWYgKGZpZWxkTmFtZSkge1xuICAgICAgICAgIHJlc29sdmVkUmVzb3VyY2VzLnB1c2goYGFybjphd3M6YXBwc3luYzoke3JlZ2lvbn06JHthY2NvdW50fTphcGlzLyR7dGhpcy5hcHBzeW5jQVBJLmFwaUlkfS90eXBlcy8ke3R5cGVOYW1lfS9maWVsZHMvJHtmaWVsZE5hbWV9YCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzb2x2ZWRSZXNvdXJjZXMucHVzaChgYXJuOmF3czphcHBzeW5jOiR7cmVnaW9ufToke2FjY291bnR9OmFwaXMvJHt0aGlzLmFwcHN5bmNBUEkuYXBpSWR9L3R5cGVzLyR7dHlwZU5hbWV9LypgKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXNvbHZlZFJlc291cmNlcztcbiAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIGFkZExhbWJkYURhdGFTb3VyY2VBbmRSZXNvbHZlcnMoXG4gICAgZnVuY3Rpb25OYW1lOiBzdHJpbmcsXG4gICAgaWQ6IHN0cmluZyxcbiAgICBsYW1iZGFGdW5jdGlvbjogSUZ1bmN0aW9uLFxuICAgIG9wdGlvbnM/OiBEYXRhU291cmNlT3B0aW9ucyxcbiAgKTogTGFtYmRhRGF0YVNvdXJjZSB7XG4gICAgY29uc3QgZnVuY3Rpb25EYXRhU291cmNlID0gdGhpcy5hcHBzeW5jQVBJLmFkZExhbWJkYURhdGFTb3VyY2UoXG4gICAgICBpZCxcbiAgICAgIGxhbWJkYUZ1bmN0aW9uLFxuICAgICAgb3B0aW9ucyxcbiAgICApO1xuXG4gICAgZm9yIChjb25zdCByZXNvbHZlciBvZiB0aGlzLmZ1bmN0aW9uUmVzb2x2ZXJzW2Z1bmN0aW9uTmFtZV0pIHtcbiAgICAgIG5ldyBSZXNvbHZlcihcbiAgICAgICAgdGhpcy5uZXN0ZWRBcHBzeW5jU3RhY2ssXG4gICAgICAgIGAke3Jlc29sdmVyLnR5cGVOYW1lfS0ke3Jlc29sdmVyLmZpZWxkTmFtZX0tcmVzb2x2ZXJgLFxuICAgICAgICB7XG4gICAgICAgICAgYXBpOiB0aGlzLmFwcHN5bmNBUEksXG4gICAgICAgICAgdHlwZU5hbWU6IHJlc29sdmVyLnR5cGVOYW1lLFxuICAgICAgICAgIGZpZWxkTmFtZTogcmVzb2x2ZXIuZmllbGROYW1lLFxuICAgICAgICAgIGRhdGFTb3VyY2U6IGZ1bmN0aW9uRGF0YVNvdXJjZSxcbiAgICAgICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBNYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhcbiAgICAgICAgICAgIHJlc29sdmVyLmRlZmF1bHRSZXF1ZXN0TWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICksXG4gICAgICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IE1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKFxuICAgICAgICAgICAgcmVzb2x2ZXIuZGVmYXVsdFJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICksIC8vIFRoaXMgZGVmYXVsdHMgdG8gYWxsb3cgZXJyb3JzIHRvIHJldHVybiB0byB0aGUgY2xpZW50IGluc3RlYWQgb2YgdGhyb3dpbmdcbiAgICAgICAgfSxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZ1bmN0aW9uRGF0YVNvdXJjZTtcbiAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyBhZGREeW5hbW9EQlN0cmVhbShwcm9wczogRHluYW1vREJTdHJlYW1Qcm9wcyk6IHN0cmluZyB7XG4gICAgY29uc3QgdGFibGVOYW1lID0gYCR7cHJvcHMubW9kZWxUeXBlTmFtZX1UYWJsZWA7XG4gICAgY29uc3QgdGFibGUgPSB0aGlzLnRhYmxlTWFwW3RhYmxlTmFtZV07XG4gICAgaWYgKCF0YWJsZSkgdGhyb3cgbmV3IEVycm9yKGBUYWJsZSB3aXRoIG5hbWUgJyR7dGFibGVOYW1lfScgbm90IGZvdW5kLmApO1xuXG4gICAgY29uc3QgY2ZuVGFibGUgPSB0YWJsZS5ub2RlLmRlZmF1bHRDaGlsZCBhcyBDZm5UYWJsZTtcbiAgICBjZm5UYWJsZS5zdHJlYW1TcGVjaWZpY2F0aW9uID0ge1xuICAgICAgc3RyZWFtVmlld1R5cGU6IHByb3BzLnN0cmVhbVZpZXdUeXBlLFxuICAgIH07XG5cbiAgICByZXR1cm4gY2ZuVGFibGUuYXR0clN0cmVhbUFybjtcbiAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIGdyYW50UHVibGljKGdyYW50ZWU6IElHcmFudGFibGUpOiBHcmFudCB7XG4gICAgcmV0dXJuIEdyYW50LmFkZFRvUHJpbmNpcGFsKHtcbiAgICAgIGdyYW50ZWUsXG4gICAgICBhY3Rpb25zOiBbJ2FwcHN5bmM6R3JhcGhRTCddLFxuICAgICAgcmVzb3VyY2VBcm5zOiB0aGlzLnB1YmxpY1Jlc291cmNlQXJucyxcbiAgICAgIHNjb3BlOiB0aGlzLFxuICAgIH0pO1xuICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIGdyYW50UHJpdmF0ZShncmFudGVlOiBJR3JhbnRhYmxlKTogR3JhbnQge1xuICAgIHJldHVybiBHcmFudC5hZGRUb1ByaW5jaXBhbCh7XG4gICAgICBncmFudGVlLFxuICAgICAgYWN0aW9uczogWydhcHBzeW5jOkdyYXBoUUwnXSxcbiAgICAgIHJlc291cmNlQXJuczogdGhpcy5wcml2YXRlUmVzb3VyY2VBcm5zLFxuICAgIH0pO1xuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRHluYW1vREJTdHJlYW1Qcm9wcyB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSBtb2RlbFR5cGVOYW1lOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHN0cmVhbVZpZXdUeXBlOiBTdHJlYW1WaWV3VHlwZTtcbn1cbiJdfQ==