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
            // tableData[tableKey]['datasource'] = dataSource
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwc3luYy10cmFuc2Zvcm1lci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9hcHBzeW5jLXRyYW5zZm9ybWVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsc0RBVzhCO0FBRTlCLHdEQVErQjtBQUMvQiw4Q0FBOEU7QUFFOUUsd0NBQWtFO0FBV2xFLHlFQUcwQztBQWlGMUMsTUFBTSwwQkFBMEIsR0FBd0I7SUFDdEQsb0JBQW9CLEVBQUU7UUFDcEIsaUJBQWlCLEVBQUUsK0JBQWlCLENBQUMsT0FBTztRQUM1QyxZQUFZLEVBQUU7WUFDWixXQUFXLEVBQUUsdUNBQXVDO1lBQ3BELElBQUksRUFBRSxLQUFLO1NBQ1o7S0FDRjtDQUNGLENBQUM7Ozs7OztBQUtGLE1BQWEsa0JBQW1CLFNBQVEsZ0JBQVM7Ozs7SUFtRC9DLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBOEI7O1FBQ3RFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFakIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUM7UUFDbkIsSUFBSSxDQUFDLFFBQVEsR0FBRyxFQUFFLENBQUM7UUFDbkIsSUFBSSxDQUFDLGFBQWEsR0FBRyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUM7UUFDbkUsSUFBSSxDQUFDLG1CQUFtQixTQUFHLEtBQUssQ0FBQywrQkFBK0IsbUNBQUksS0FBSyxDQUFDO1FBRTFFLE1BQU0sd0JBQXdCLEdBQTJCO1lBQ3ZELFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVTtZQUM1QixXQUFXLFFBQUUsS0FBSyxDQUFDLFdBQVcsbUNBQUksS0FBSztTQUN4QyxDQUFDO1FBRUYsMENBQTBDO1FBQzFDLDZEQUE2RDtRQUM3RCxNQUFNLHFCQUFxQixHQUFHLENBQUMsU0FBRyxLQUFLLENBQUMsa0JBQWtCLG1DQUFJLEVBQUUsRUFBRSxT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QUFNLElBQUksS0FBSyxDQUFDLG9CQUFvQixTQUFTLGNBQWMsQ0FBQyxDQUFDO1FBRXpFLE1BQU0sUUFBUSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsWUFBd0IsQ0FBQztRQUNyRCxRQUFRLENBQUMsbUJBQW1CLEdBQUc7WUFDN0IsY0FBYyxFQUFFLEtBQUssQ0FBQyxjQUFjO1NBQ3JDLENBQUM7UUFFRixPQUFPLFFBQVEsQ0FBQyxhQUFhLENBQUM7SUFDaEMsQ0FBQzs7Ozs7Ozs7OztJQVFNLFdBQVcsQ0FBQyxPQUFtQjtRQUNwQyxPQUFPLGVBQUssQ0FBQyxjQUFjLENBQUM7WUFDMUIsT0FBTztZQUNQLE9BQU8sRUFBRSxDQUFDLGlCQUFpQixDQUFDO1lBQzVCLFlBQVksRUFBRSxJQUFJLENBQUMsa0JBQWtCO1lBQ3JDLEtBQUssRUFBRSxJQUFJO1NBQ1osQ0FBQyxDQUFDO0lBQ0wsQ0FBQzs7Ozs7Ozs7O0lBUU0sWUFBWSxDQUFDLE9BQW1CO1FBQ3JDLE9BQU8sZUFBSyxDQUFDLGNBQWMsQ0FBQztZQUMxQixPQUFPO1lBQ1AsT0FBTyxFQUFFLENBQUMsaUJBQWlCLENBQUM7WUFDNUIsWUFBWSxFQUFFLElBQUksQ0FBQyxtQkFBbUI7U0FDdkMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQzs7QUE1aUJILGdEQTZpQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICBHcmFwaHFsQXBpLFxuICBBdXRob3JpemF0aW9uVHlwZSxcbiAgRmllbGRMb2dMZXZlbCxcbiAgTWFwcGluZ1RlbXBsYXRlLFxuICBDZm5EYXRhU291cmNlLFxuICBSZXNvbHZlcixcbiAgQXV0aG9yaXphdGlvbkNvbmZpZyxcbiAgU2NoZW1hLFxuICBEYXRhU291cmNlT3B0aW9ucyxcbiAgTGFtYmRhRGF0YVNvdXJjZSxcbn0gZnJvbSAnQGF3cy1jZGsvYXdzLWFwcHN5bmMnO1xuXG5pbXBvcnQge1xuICBDZm5UYWJsZSxcbiAgVGFibGUsXG4gIEF0dHJpYnV0ZVR5cGUsXG4gIFByb2plY3Rpb25UeXBlLFxuICBCaWxsaW5nTW9kZSxcbiAgU3RyZWFtVmlld1R5cGUsXG4gIFRhYmxlUHJvcHMsXG59IGZyb20gJ0Bhd3MtY2RrL2F3cy1keW5hbW9kYic7XG5pbXBvcnQgeyBFZmZlY3QsIEdyYW50LCBJR3JhbnRhYmxlLCBQb2xpY3lTdGF0ZW1lbnQgfSBmcm9tICdAYXdzLWNkay9hd3MtaWFtJztcbmltcG9ydCB7IElGdW5jdGlvbiB9IGZyb20gJ0Bhd3MtY2RrL2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgQ29uc3RydWN0LCBOZXN0ZWRTdGFjaywgQ2ZuT3V0cHV0IH0gZnJvbSAnQGF3cy1jZGsvY29yZSc7XG5cbmltcG9ydCB7XG4gIENka1RyYW5zZm9ybWVyUmVzb2x2ZXIsXG4gIENka1RyYW5zZm9ybWVyRnVuY3Rpb25SZXNvbHZlcixcbiAgQ2RrVHJhbnNmb3JtZXJIdHRwUmVzb2x2ZXIsXG4gIENka1RyYW5zZm9ybWVyVGFibGUsXG4gIFNjaGVtYVRyYW5zZm9ybWVyT3V0cHV0cyxcbn0gZnJvbSAnLi90cmFuc2Zvcm1lcic7XG5pbXBvcnQgeyBSZXNvdXJjZSB9IGZyb20gJy4vdHJhbnNmb3JtZXIvcmVzb3VyY2UnO1xuXG5pbXBvcnQge1xuICBTY2hlbWFUcmFuc2Zvcm1lcixcbiAgU2NoZW1hVHJhbnNmb3JtZXJQcm9wcyxcbn0gZnJvbSAnLi90cmFuc2Zvcm1lci9zY2hlbWEtdHJhbnNmb3JtZXInO1xuXG5leHBvcnQgaW50ZXJmYWNlIEFwcFN5bmNUcmFuc2Zvcm1lclByb3BzIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcmVhZG9ubHkgc2NoZW1hUGF0aDogc3RyaW5nO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IGF1dGhvcml6YXRpb25Db25maWc/OiBBdXRob3JpemF0aW9uQ29uZmlnO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcmVhZG9ubHkgYXBpTmFtZT86IHN0cmluZztcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSBzeW5jRW5hYmxlZD86IGJvb2xlYW47XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcmVhZG9ubHkgZW5hYmxlRHluYW1vUG9pbnRJblRpbWVSZWNvdmVyeT86IGJvb2xlYW47XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IGZpZWxkTG9nTGV2ZWw/OiBGaWVsZExvZ0xldmVsO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IHhyYXlFbmFibGVkPzogYm9vbGVhbjtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcmVhZG9ubHkgdGFibGVOYW1lcz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IGR5bmFtb0RiU3RyZWFtQ29uZmlnPzogeyBbbmFtZTogc3RyaW5nXTogU3RyZWFtVmlld1R5cGUgfTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSBuZXN0ZWRTdGFja05hbWU/OiBzdHJpbmc7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcblxuICByZWFkb25seSBwcmVDZGtUcmFuc2Zvcm1lcnM/OiBhbnlbXTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG5cbiAgcmVhZG9ubHkgcG9zdENka1RyYW5zZm9ybWVycz86IGFueVtdO1xufVxuXG5jb25zdCBkZWZhdWx0QXV0aG9yaXphdGlvbkNvbmZpZzogQXV0aG9yaXphdGlvbkNvbmZpZyA9IHtcbiAgZGVmYXVsdEF1dGhvcml6YXRpb246IHtcbiAgICBhdXRob3JpemF0aW9uVHlwZTogQXV0aG9yaXphdGlvblR5cGUuQVBJX0tFWSxcbiAgICBhcGlLZXlDb25maWc6IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQXV0byBnZW5lcmF0ZWQgQVBJIEtleSBmcm9tIGNvbnN0cnVjdCcsXG4gICAgICBuYW1lOiAnZGV2JyxcbiAgICB9LFxuICB9LFxufTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG5leHBvcnQgY2xhc3MgQXBwU3luY1RyYW5zZm9ybWVyIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICBwdWJsaWMgcmVhZG9ubHkgYXBwc3luY0FQSTogR3JhcGhxbEFwaTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIHJlYWRvbmx5IG5lc3RlZEFwcHN5bmNTdGFjazogTmVzdGVkU3RhY2s7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIHJlYWRvbmx5IHRhYmxlTmFtZU1hcDogeyBbbmFtZTogc3RyaW5nXTogc3RyaW5nIH07XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyByZWFkb25seSB0YWJsZU1hcDogeyBbbmFtZTogc3RyaW5nXTogVGFibGUgfTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICBwdWJsaWMgcmVhZG9ubHkgb3V0cHV0czogU2NoZW1hVHJhbnNmb3JtZXJPdXRwdXRzO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyByZWFkb25seSByZXNvbHZlcnM6IHsgW25hbWU6IHN0cmluZ106IENka1RyYW5zZm9ybWVyUmVzb2x2ZXIgfTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyByZWFkb25seSBmdW5jdGlvblJlc29sdmVyczoge1xuICAgIFtuYW1lOiBzdHJpbmddOiBDZGtUcmFuc2Zvcm1lckZ1bmN0aW9uUmVzb2x2ZXJbXTtcbiAgfTtcblxuICBwdWJsaWMgcmVhZG9ubHkgaHR0cFJlc29sdmVyczoge1xuICAgIFtuYW1lOiBzdHJpbmddOiBDZGtUcmFuc2Zvcm1lckh0dHBSZXNvbHZlcltdO1xuICB9O1xuXG4gIHByaXZhdGUgcHJvcHM6IEFwcFN5bmNUcmFuc2Zvcm1lclByb3BzXG4gIHByaXZhdGUgaXNTeW5jRW5hYmxlZDogYm9vbGVhbjtcbiAgcHJpdmF0ZSBzeW5jVGFibGU6IFRhYmxlIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHBvaW50SW5UaW1lUmVjb3Zlcnk6IGJvb2xlYW47XG4gIHByaXZhdGUgcmVhZG9ubHkgcHVibGljUmVzb3VyY2VBcm5zOiBzdHJpbmdbXTtcbiAgcHJpdmF0ZSByZWFkb25seSBwcml2YXRlUmVzb3VyY2VBcm5zOiBzdHJpbmdbXTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQXBwU3luY1RyYW5zZm9ybWVyUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgdGhpcy5wcm9wcyA9IHByb3BzO1xuICAgIHRoaXMudGFibGVNYXAgPSB7fTtcbiAgICB0aGlzLmlzU3luY0VuYWJsZWQgPSBwcm9wcy5zeW5jRW5hYmxlZCA/IHByb3BzLnN5bmNFbmFibGVkIDogZmFsc2U7XG4gICAgdGhpcy5wb2ludEluVGltZVJlY292ZXJ5ID0gcHJvcHMuZW5hYmxlRHluYW1vUG9pbnRJblRpbWVSZWNvdmVyeSA/PyBmYWxzZTtcblxuICAgIGNvbnN0IHRyYW5zZm9ybWVyQ29uZmlndXJhdGlvbjogU2NoZW1hVHJhbnNmb3JtZXJQcm9wcyA9IHtcbiAgICAgIHNjaGVtYVBhdGg6IHByb3BzLnNjaGVtYVBhdGgsXG4gICAgICBzeW5jRW5hYmxlZDogcHJvcHMuc3luY0VuYWJsZWQgPz8gZmFsc2UsXG4gICAgfTtcblxuICAgIC8vIENvbWJpbmUgdGhlIGFycmF5cyBzbyB3ZSBvbmx5IGxvb3Agb25jZVxuICAgIC8vIFRlc3QgZWFjaCB0cmFuc2Zvcm1lciB0byBzZWUgaWYgaXQgaW1wbGVtZW50cyBJVHJhbnNmb3JtZXJcbiAgICBjb25zdCBhbGxDdXN0b21UcmFuc2Zvcm1lcnMgPSBbLi4ucHJvcHMucHJlQ2RrVHJhbnNmb3JtZXJzID8/IFtdLCAuLi5wcm9wcy5wb3N0Q2RrVHJhbnNmb3JtZXJzID8/IFtdXTtcbiAgICBpZiAoYWxsQ3VzdG9tVHJhbnNmb3JtZXJzICYmIGFsbEN1c3RvbVRyYW5zZm9ybWVycy5sZW5ndGggPiAwKSB7XG4gICAgICBhbGxDdXN0b21UcmFuc2Zvcm1lcnMuZm9yRWFjaCh0cmFuc2Zvcm1lciA9PiB7XG4gICAgICAgIGlmICh0cmFuc2Zvcm1lciAmJiAhdGhpcy5pbXBsZW1lbnRzSVRyYW5zZm9ybWVyKHRyYW5zZm9ybWVyKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVHJhbnNmb3JtZXIgZG9lcyBub3QgaW1wbGVtZW50IElUcmFuc2Zvcm1lciBmcm9tIGdyYXBocWwtdHJhbnNmb3JtZXItY29yZTogJHt0cmFuc2Zvcm1lcn1gKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgdHJhbnNmb3JtZXIgPSBuZXcgU2NoZW1hVHJhbnNmb3JtZXIodHJhbnNmb3JtZXJDb25maWd1cmF0aW9uKTtcbiAgICB0aGlzLm91dHB1dHMgPSB0cmFuc2Zvcm1lci50cmFuc2Zvcm0ocHJvcHMucHJlQ2RrVHJhbnNmb3JtZXJzLCBwcm9wcy5wb3N0Q2RrVHJhbnNmb3JtZXJzKTtcbiAgICBjb25zdCByZXNvbHZlcnMgPSB0cmFuc2Zvcm1lci5nZXRSZXNvbHZlcnMoKTtcblxuICAgIHRoaXMuZnVuY3Rpb25SZXNvbHZlcnMgPSB0aGlzLm91dHB1dHMuZnVuY3Rpb25SZXNvbHZlcnMgPz8ge307XG5cbiAgICAvLyBSZW1vdmUgYW55IGZ1bmN0aW9uIHJlc29sdmVycyBmcm9tIHRoZSB0b3RhbCBsaXN0IG9mIHJlc29sdmVyc1xuICAgIC8vIE90aGVyd2lzZSBpdCB3aWxsIGFkZCB0aGVtIHR3aWNlXG4gICAgZm9yIChjb25zdCBbXywgZnVuY3Rpb25SZXNvbHZlcnNdIG9mIE9iamVjdC5lbnRyaWVzKFxuICAgICAgdGhpcy5mdW5jdGlvblJlc29sdmVycyxcbiAgICApKSB7XG4gICAgICBmdW5jdGlvblJlc29sdmVycy5mb3JFYWNoKChyZXNvbHZlcikgPT4ge1xuICAgICAgICBzd2l0Y2ggKHJlc29sdmVyLnR5cGVOYW1lKSB7XG4gICAgICAgICAgY2FzZSAnUXVlcnknOlxuICAgICAgICAgIGNhc2UgJ011dGF0aW9uJzpcbiAgICAgICAgICBjYXNlICdTdWJzY3JpcHRpb24nOlxuICAgICAgICAgICAgZGVsZXRlIHJlc29sdmVyc1tyZXNvbHZlci5maWVsZE5hbWVdO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHRoaXMuaHR0cFJlc29sdmVycyA9IHRoaXMub3V0cHV0cy5odHRwUmVzb2x2ZXJzID8/IHt9O1xuXG4gICAgLy8gUmVtb3ZlIGFueSBodHRwIHJlc29sdmVycyBmcm9tIHRoZSB0b3RhbCBsaXN0IG9mIHJlc29sdmVyc1xuICAgIC8vIE90aGVyd2lzZSBpdCB3aWxsIGFkZCB0aGVtIHR3aWNlXG4gICAgZm9yIChjb25zdCBbXywgaHR0cFJlc29sdmVyc10gb2YgT2JqZWN0LmVudHJpZXModGhpcy5odHRwUmVzb2x2ZXJzKSkge1xuICAgICAgaHR0cFJlc29sdmVycy5mb3JFYWNoKChyZXNvbHZlcikgPT4ge1xuICAgICAgICBzd2l0Y2ggKHJlc29sdmVyLnR5cGVOYW1lKSB7XG4gICAgICAgICAgY2FzZSAnUXVlcnknOlxuICAgICAgICAgIGNhc2UgJ011dGF0aW9uJzpcbiAgICAgICAgICBjYXNlICdTdWJzY3JpcHRpb24nOlxuICAgICAgICAgICAgZGVsZXRlIHJlc29sdmVyc1tyZXNvbHZlci5maWVsZE5hbWVdO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHRoaXMucmVzb2x2ZXJzID0gcmVzb2x2ZXJzO1xuXG4gICAgdGhpcy5uZXN0ZWRBcHBzeW5jU3RhY2sgPSBuZXcgTmVzdGVkU3RhY2sodGhpcywgcHJvcHMubmVzdGVkU3RhY2tOYW1lID8/ICdhcHBzeW5jLW5lc3RlZC1zdGFjaycpO1xuXG4gICAgLy8gQXBwU3luY1xuICAgIHRoaXMuYXBwc3luY0FQSSA9IG5ldyBHcmFwaHFsQXBpKHRoaXMubmVzdGVkQXBwc3luY1N0YWNrLCBgJHtpZH0tYXBpYCwge1xuICAgICAgbmFtZTogcHJvcHMuYXBpTmFtZSA/IHByb3BzLmFwaU5hbWUgOiBgJHtpZH0tYXBpYCxcbiAgICAgIGF1dGhvcml6YXRpb25Db25maWc6IHByb3BzLmF1dGhvcml6YXRpb25Db25maWdcbiAgICAgICAgPyBwcm9wcy5hdXRob3JpemF0aW9uQ29uZmlnXG4gICAgICAgIDogZGVmYXVsdEF1dGhvcml6YXRpb25Db25maWcsXG4gICAgICBsb2dDb25maWc6IHtcbiAgICAgICAgZmllbGRMb2dMZXZlbDogcHJvcHMuZmllbGRMb2dMZXZlbFxuICAgICAgICAgID8gcHJvcHMuZmllbGRMb2dMZXZlbFxuICAgICAgICAgIDogRmllbGRMb2dMZXZlbC5OT05FLFxuICAgICAgfSxcbiAgICAgIHNjaGVtYTogU2NoZW1hLmZyb21Bc3NldCgnLi9hcHBzeW5jL3NjaGVtYS5ncmFwaHFsJyksXG4gICAgICB4cmF5RW5hYmxlZDogcHJvcHMueHJheUVuYWJsZWQgPz8gZmFsc2UsXG4gICAgfSk7XG5cbiAgICBsZXQgdGFibGVEYXRhID0gdGhpcy5vdXRwdXRzLmNka1RhYmxlcyA/PyB7fTtcblxuICAgIC8vIENoZWNrIHRvIHNlZSBpZiBzeW5jIGlzIGVuYWJsZWRcbiAgICBpZiAodGFibGVEYXRhLkRhdGFTdG9yZSkge1xuICAgICAgdGhpcy5pc1N5bmNFbmFibGVkID0gdHJ1ZTtcbiAgICAgIHRoaXMuc3luY1RhYmxlID0gdGhpcy5jcmVhdGVTeW5jVGFibGUodGFibGVEYXRhLkRhdGFTdG9yZSk7XG4gICAgICBkZWxldGUgdGFibGVEYXRhLkRhdGFTdG9yZTsgLy8gV2UgZG9uJ3Qgd2FudCB0byBjcmVhdGUgdGhpcyBhZ2FpbiBiZWxvdyBzbyByZW1vdmUgaXQgZnJvbSB0aGUgdGFibGVEYXRhIG1hcFxuICAgIH1cblxuICAgIHRoaXMudGFibGVOYW1lTWFwID0gdGhpcy5jcmVhdGVUYWJsZXNBbmRSZXNvbHZlcnModGFibGVEYXRhLCByZXNvbHZlcnMsIHByb3BzLnRhYmxlTmFtZXMpO1xuICAgIGlmICh0aGlzLm91dHB1dHMubm9uZVJlc29sdmVycykge1xuICAgICAgdGhpcy5jcmVhdGVOb25lRGF0YVNvdXJjZUFuZFJlc29sdmVycyhcbiAgICAgICAgdGhpcy5vdXRwdXRzLm5vbmVSZXNvbHZlcnMsXG4gICAgICAgIHJlc29sdmVycyxcbiAgICAgICk7XG4gICAgfVxuICAgIHRoaXMuY3JlYXRlSHR0cFJlc29sdmVycygpO1xuXG4gICAgdGhpcy5wdWJsaWNSZXNvdXJjZUFybnMgPSB0aGlzLmdldFJlc291cmNlc0Zyb21HZW5lcmF0ZWRSb2xlUG9saWN5KHRyYW5zZm9ybWVyLnVuYXV0aFJvbGVQb2xpY3kpO1xuICAgIHRoaXMucHJpdmF0ZVJlc291cmNlQXJucyA9IHRoaXMuZ2V0UmVzb3VyY2VzRnJvbUdlbmVyYXRlZFJvbGVQb2xpY3kodHJhbnNmb3JtZXIuYXV0aFJvbGVQb2xpY3kpO1xuXG4gICAgLy8gT3V0cHV0cyBzbyB3ZSBjYW4gZ2VuZXJhdGUgZXhwb3J0c1xuICAgIG5ldyBDZm5PdXRwdXQoc2NvcGUsICdhcHBzeW5jR3JhcGhRTEVuZHBvaW50T3V0cHV0Jywge1xuICAgICAgdmFsdWU6IHRoaXMuYXBwc3luY0FQSS5ncmFwaHFsVXJsLFxuICAgICAgZGVzY3JpcHRpb246ICdPdXRwdXQgZm9yIGF3c19hcHBzeW5jX2dyYXBocWxFbmRwb2ludCcsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogZ3JhcGhxbC10cmFuc2Zvcm1lci1jb3JlIG5lZWRzIHRvIGJlIGpzaWkgZW5hYmxlZCB0byBwdWxsIHRoZSBJVHJhbnNmb3JtZXIgaW50ZXJmYWNlIGNvcnJlY3RseS5cbiAgICogU2luY2UgaXQncyBub3QgaW4gcGVlciBkZXBlbmRlbmNpZXMgaXQgZG9lc24ndCBzaG93IHVwIGluIHRoZSBqc2lpIGRlcHMgbGlzdC5cbiAgICogU2luY2UgaXQncyBub3QganNpaSBlbmFibGVkIGl0IGhhcyB0byBiZSBidW5kbGVkLlxuICAgKiBUaGUgcGFja2FnZSBjYW4ndCBiZSBpbiBCT1RIIHBlZXIgYW5kIGJ1bmRsZWQgZGVwZW5kZW5jaWVzXG4gICAqIFNvIHdlIGRvIGEgZmFrZSB0ZXN0IHRvIG1ha2Ugc3VyZSBpdCBpbXBsZW1lbnRzIHRoZXNlIGFuZCBob3BlIGZvciB0aGUgYmVzdFxuICAgKiBAcGFyYW0gdHJhbnNmb3JtZXJcbiAgICovXG4gIHByaXZhdGUgaW1wbGVtZW50c0lUcmFuc2Zvcm1lcih0cmFuc2Zvcm1lcjogYW55KSB7XG4gICAgcmV0dXJuICduYW1lJyBpbiB0cmFuc2Zvcm1lclxuICAgICAgJiYgJ2RpcmVjdGl2ZScgaW4gdHJhbnNmb3JtZXJcbiAgICAgICYmICd0eXBlRGVmaW5pdGlvbnMnIGluIHRyYW5zZm9ybWVyO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgTk9ORSBkYXRhIHNvdXJjZSBhbmQgYXNzb2NpYXRlZCByZXNvbHZlcnNcbiAgICogQHBhcmFtIG5vbmVSZXNvbHZlcnMgVGhlIHJlc29sdmVycyB0aGF0IGJlbG9uZyB0byB0aGUgbm9uZSBkYXRhIHNvdXJjZVxuICAgKiBAcGFyYW0gcmVzb2x2ZXJzIFRoZSByZXNvbHZlciBtYXAgbWludXMgZnVuY3Rpb24gcmVzb2x2ZXJzXG4gICAqL1xuICBwcml2YXRlIGNyZWF0ZU5vbmVEYXRhU291cmNlQW5kUmVzb2x2ZXJzKFxuICAgIG5vbmVSZXNvbHZlcnM6IHsgW25hbWU6IHN0cmluZ106IENka1RyYW5zZm9ybWVyUmVzb2x2ZXIgfSxcbiAgICByZXNvbHZlcnM6IGFueSxcbiAgKSB7XG4gICAgY29uc3Qgbm9uZURhdGFTb3VyY2UgPSB0aGlzLmFwcHN5bmNBUEkuYWRkTm9uZURhdGFTb3VyY2UoJ05PTkUnKTtcblxuICAgIE9iamVjdC5rZXlzKG5vbmVSZXNvbHZlcnMpLmZvckVhY2goKHJlc29sdmVyS2V5KSA9PiB7XG4gICAgICBjb25zdCByZXNvbHZlciA9IHJlc29sdmVyc1tyZXNvbHZlcktleV07XG4gICAgICBuZXcgUmVzb2x2ZXIoXG4gICAgICAgIHRoaXMubmVzdGVkQXBwc3luY1N0YWNrLFxuICAgICAgICBgJHtyZXNvbHZlci50eXBlTmFtZX0tJHtyZXNvbHZlci5maWVsZE5hbWV9LXJlc29sdmVyYCxcbiAgICAgICAge1xuICAgICAgICAgIGFwaTogdGhpcy5hcHBzeW5jQVBJLFxuICAgICAgICAgIHR5cGVOYW1lOiByZXNvbHZlci50eXBlTmFtZSxcbiAgICAgICAgICBmaWVsZE5hbWU6IHJlc29sdmVyLmZpZWxkTmFtZSxcbiAgICAgICAgICBkYXRhU291cmNlOiBub25lRGF0YVNvdXJjZSxcbiAgICAgICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBNYXBwaW5nVGVtcGxhdGUuZnJvbUZpbGUoXG4gICAgICAgICAgICByZXNvbHZlci5yZXF1ZXN0TWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICksXG4gICAgICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IE1hcHBpbmdUZW1wbGF0ZS5mcm9tRmlsZShcbiAgICAgICAgICAgIHJlc29sdmVyLnJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICksXG4gICAgICAgIH0sXG4gICAgICApO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgZWFjaCBkeW5hbW9kYiB0YWJsZSwgZ3NpcywgZHluYW1vZGIgZGF0YXNvdXJjZSwgYW5kIGFzc29jaWF0ZWQgcmVzb2x2ZXJzXG4gICAqIElmIHN5bmMgaXMgZW5hYmxlZCB0aGVuIFRUTCBjb25maWd1cmF0aW9uIGlzIGFkZGVkXG4gICAqIFJldHVybnMgdGFibGVOYW1lOiB0YWJsZSBtYXAgaW4gY2FzZSBpdCBpcyBuZWVkZWQgZm9yIGxhbWJkYSBmdW5jdGlvbnMsIGV0Y1xuICAgKiBAcGFyYW0gdGFibGVEYXRhIFRoZSBDZGtUcmFuc2Zvcm1lciB0YWJsZSBpbmZvcm1hdGlvblxuICAgKiBAcGFyYW0gcmVzb2x2ZXJzIFRoZSByZXNvbHZlciBtYXAgbWludXMgZnVuY3Rpb24gcmVzb2x2ZXJzXG4gICAqL1xuICBwcml2YXRlIGNyZWF0ZVRhYmxlc0FuZFJlc29sdmVycyhcbiAgICB0YWJsZURhdGE6IHsgW25hbWU6IHN0cmluZ106IENka1RyYW5zZm9ybWVyVGFibGUgfSxcbiAgICByZXNvbHZlcnM6IGFueSxcbiAgICB0YWJsZU5hbWVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge30sXG4gICk6IHsgW25hbWU6IHN0cmluZ106IHN0cmluZyB9IHtcbiAgICBjb25zdCB0YWJsZU5hbWVNYXA6IGFueSA9IHt9O1xuXG4gICAgT2JqZWN0LmtleXModGFibGVEYXRhKS5mb3JFYWNoKCh0YWJsZUtleSkgPT4ge1xuICAgICAgY29uc3QgdGFibGVOYW1lID0gdGFibGVOYW1lc1t0YWJsZUtleV0gPz8gdW5kZWZpbmVkO1xuICAgICAgY29uc3QgdGFibGUgPSB0aGlzLmNyZWF0ZVRhYmxlKHRhYmxlRGF0YVt0YWJsZUtleV0sIHRhYmxlTmFtZSk7XG4gICAgICB0aGlzLnRhYmxlTWFwW3RhYmxlS2V5XSA9IHRhYmxlO1xuXG4gICAgICBjb25zdCBkYXRhU291cmNlID0gdGhpcy5hcHBzeW5jQVBJLmFkZER5bmFtb0RiRGF0YVNvdXJjZSh0YWJsZUtleSwgdGFibGUpO1xuXG4gICAgICAvLyBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vQVdTQ2xvdWRGb3JtYXRpb24vbGF0ZXN0L1VzZXJHdWlkZS9hd3MtcHJvcGVydGllcy1hcHBzeW5jLWRhdGFzb3VyY2UtZGVsdGFzeW5jY29uZmlnLmh0bWxcblxuICAgICAgaWYgKHRoaXMuaXNTeW5jRW5hYmxlZCAmJiB0aGlzLnN5bmNUYWJsZSkge1xuICAgICAgICAvL0B0cy1pZ25vcmUgLSBkcyBpcyB0aGUgYmFzZSBDZm5EYXRhU291cmNlIGFuZCB0aGUgZGIgY29uZmlnIG5lZWRzIHRvIGJlIHZlcnNpb25lZCAtIHNlZSBDZm5EYXRhU291cmNlXG4gICAgICAgIGRhdGFTb3VyY2UuZHMuZHluYW1vRGJDb25maWcudmVyc2lvbmVkID0gdHJ1ZTtcblxuICAgICAgICAvL0B0cy1pZ25vcmUgLSBkcyBpcyB0aGUgYmFzZSBDZm5EYXRhU291cmNlIC0gc2VlIENmbkRhdGFTb3VyY2VcbiAgICAgICAgZGF0YVNvdXJjZS5kcy5keW5hbW9EYkNvbmZpZy5kZWx0YVN5bmNDb25maWcgPSB7XG4gICAgICAgICAgYmFzZVRhYmxlVHRsOiAnNDMyMDAnLCAvLyBHb3QgdGhpcyB2YWx1ZSBmcm9tIGFtcGxpZnkgLSAzMCBkYXlzIGluIG1pbnV0ZXNcbiAgICAgICAgICBkZWx0YVN5bmNUYWJsZU5hbWU6IHRoaXMuc3luY1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgICBkZWx0YVN5bmNUYWJsZVR0bDogJzMwJywgLy8gR290IHRoaXMgdmFsdWUgZnJvbSBhbXBsaWZ5IC0gMzAgbWludXRlc1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIE5lZWQgdG8gYWRkIHBlcm1pc3Npb24gZm9yIG91ciBkYXRhc291cmNlIHNlcnZpY2Ugcm9sZSB0byBhY2Nlc3MgdGhlIHN5bmMgdGFibGVcbiAgICAgICAgZGF0YVNvdXJjZS5ncmFudFByaW5jaXBhbC5hZGRUb1BvbGljeShcbiAgICAgICAgICBuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgIGVmZmVjdDogRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAnZHluYW1vZGI6KicsIC8vIFRPRE86IFRoaXMgbWF5IGJlIHRvbyBwZXJtaXNzaXZlXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy5zeW5jVGFibGUudGFibGVBcm5dLFxuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBkeW5hbW9EYkNvbmZpZyA9IGRhdGFTb3VyY2UuZHNcbiAgICAgICAgLmR5bmFtb0RiQ29uZmlnIGFzIENmbkRhdGFTb3VyY2UuRHluYW1vREJDb25maWdQcm9wZXJ0eTtcbiAgICAgIHRhYmxlTmFtZU1hcFt0YWJsZUtleV0gPSBkeW5hbW9EYkNvbmZpZy50YWJsZU5hbWU7XG5cbiAgICAgIC8vRXhwb3NlIGRhdGFzb3VyY2UgdG8gc3VwcG9ydCBhZGRpbmcgbXVsdGlwbGUgcmVzb2x2ZXJzXG4gICAgICAvLyB0YWJsZURhdGFbdGFibGVLZXldWydkYXRhc291cmNlJ10gPSBkYXRhU291cmNlXG5cblxuICAgICAgLy8gTG9vcCB0aGUgYmFzaWMgcmVzb2x2ZXJzXG4gICAgICB0YWJsZURhdGFbdGFibGVLZXldLnJlc29sdmVycy5mb3JFYWNoKChyZXNvbHZlcktleSkgPT4ge1xuICAgICAgICBsZXQgcmVzb2x2ZXIgPSByZXNvbHZlcnNbcmVzb2x2ZXJLZXldO1xuICAgICAgICBuZXcgUmVzb2x2ZXIoXG4gICAgICAgICAgdGhpcy5uZXN0ZWRBcHBzeW5jU3RhY2ssXG4gICAgICAgICAgYCR7cmVzb2x2ZXIudHlwZU5hbWV9LSR7cmVzb2x2ZXIuZmllbGROYW1lfS1yZXNvbHZlcmAsXG4gICAgICAgICAge1xuICAgICAgICAgICAgYXBpOiB0aGlzLmFwcHN5bmNBUEksXG4gICAgICAgICAgICB0eXBlTmFtZTogcmVzb2x2ZXIudHlwZU5hbWUsXG4gICAgICAgICAgICBmaWVsZE5hbWU6IHJlc29sdmVyLmZpZWxkTmFtZSxcbiAgICAgICAgICAgIGRhdGFTb3VyY2U6IGRhdGFTb3VyY2UsXG4gICAgICAgICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBNYXBwaW5nVGVtcGxhdGUuZnJvbUZpbGUoXG4gICAgICAgICAgICAgIHJlc29sdmVyLnJlcXVlc3RNYXBwaW5nVGVtcGxhdGUsXG4gICAgICAgICAgICApLFxuICAgICAgICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IE1hcHBpbmdUZW1wbGF0ZS5mcm9tRmlsZShcbiAgICAgICAgICAgICAgcmVzb2x2ZXIucmVzcG9uc2VNYXBwaW5nVGVtcGxhdGUsXG4gICAgICAgICAgICApLFxuICAgICAgICAgIH0sXG4gICAgICAgICk7XG4gICAgICB9KTtcblxuICAgICAgLy8gTG9vcCB0aGUgZ3NpIHJlc29sdmVyc1xuICAgICAgdGFibGVEYXRhW3RhYmxlS2V5XS5nc2lSZXNvbHZlcnMuZm9yRWFjaCgocmVzb2x2ZXJLZXkpID0+IHtcbiAgICAgICAgbGV0IHJlc29sdmVyID0gcmVzb2x2ZXJzLmdzaVtyZXNvbHZlcktleV07XG4gICAgICAgIG5ldyBSZXNvbHZlcihcbiAgICAgICAgICB0aGlzLm5lc3RlZEFwcHN5bmNTdGFjayxcbiAgICAgICAgICBgJHtyZXNvbHZlci50eXBlTmFtZX0tJHtyZXNvbHZlci5maWVsZE5hbWV9LXJlc29sdmVyYCxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBhcGk6IHRoaXMuYXBwc3luY0FQSSxcbiAgICAgICAgICAgIHR5cGVOYW1lOiByZXNvbHZlci50eXBlTmFtZSxcbiAgICAgICAgICAgIGZpZWxkTmFtZTogcmVzb2x2ZXIuZmllbGROYW1lLFxuICAgICAgICAgICAgZGF0YVNvdXJjZTogZGF0YVNvdXJjZSxcbiAgICAgICAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IE1hcHBpbmdUZW1wbGF0ZS5mcm9tRmlsZShcbiAgICAgICAgICAgICAgcmVzb2x2ZXIucmVxdWVzdE1hcHBpbmdUZW1wbGF0ZSxcbiAgICAgICAgICAgICksXG4gICAgICAgICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogTWFwcGluZ1RlbXBsYXRlLmZyb21GaWxlKFxuICAgICAgICAgICAgICByZXNvbHZlci5yZXNwb25zZU1hcHBpbmdUZW1wbGF0ZSxcbiAgICAgICAgICAgICksXG4gICAgICAgICAgfSxcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHRhYmxlTmFtZU1hcDtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlVGFibGUodGFibGVEYXRhOiBDZGtUcmFuc2Zvcm1lclRhYmxlLCB0YWJsZU5hbWU/OiBzdHJpbmcpIHtcbiAgICAvLyBJIGRvIG5vdCB3YW50IHRvIGZvcmNlIHBlb3BsZSB0byBwYXNzIGBUeXBlVGFibGVgIC0gdGhpcyB3YXkgdGhleSBhcmUgb25seSBwYXNzaW5nIHRoZSBAbW9kZWwgVHlwZSBuYW1lXG4gICAgY29uc3QgbW9kZWxUeXBlTmFtZSA9IHRhYmxlRGF0YS50YWJsZU5hbWUucmVwbGFjZSgnVGFibGUnLCAnJyk7XG4gICAgY29uc3Qgc3RyZWFtU3BlY2lmaWNhdGlvbiA9IHRoaXMucHJvcHMuZHluYW1vRGJTdHJlYW1Db25maWcgJiYgdGhpcy5wcm9wcy5keW5hbW9EYlN0cmVhbUNvbmZpZ1ttb2RlbFR5cGVOYW1lXTtcbiAgICBjb25zdCB0YWJsZVByb3BzOiBUYWJsZVByb3BzID0ge1xuICAgICAgdGFibGVOYW1lLFxuICAgICAgYmlsbGluZ01vZGU6IEJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICBuYW1lOiB0YWJsZURhdGEucGFydGl0aW9uS2V5Lm5hbWUsXG4gICAgICAgIHR5cGU6IHRoaXMuY29udmVydEF0dHJpYnV0ZVR5cGUodGFibGVEYXRhLnBhcnRpdGlvbktleS50eXBlKSxcbiAgICAgIH0sXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0aGlzLnBvaW50SW5UaW1lUmVjb3ZlcnksXG4gICAgICBzb3J0S2V5OiB0YWJsZURhdGEuc29ydEtleSAmJiB0YWJsZURhdGEuc29ydEtleS5uYW1lXG4gICAgICAgID8ge1xuICAgICAgICAgIG5hbWU6IHRhYmxlRGF0YS5zb3J0S2V5Lm5hbWUsXG4gICAgICAgICAgdHlwZTogdGhpcy5jb252ZXJ0QXR0cmlidXRlVHlwZSh0YWJsZURhdGEuc29ydEtleS50eXBlKSxcbiAgICAgICAgfSA6IHVuZGVmaW5lZCxcbiAgICAgIHRpbWVUb0xpdmVBdHRyaWJ1dGU6IHRhYmxlRGF0YT8udHRsPy5lbmFibGVkID8gdGFibGVEYXRhLnR0bC5hdHRyaWJ1dGVOYW1lIDogdW5kZWZpbmVkLFxuICAgICAgc3RyZWFtOiBzdHJlYW1TcGVjaWZpY2F0aW9uLFxuICAgIH07XG5cbiAgICBjb25zdCB0YWJsZSA9IG5ldyBUYWJsZShcbiAgICAgIHRoaXMubmVzdGVkQXBwc3luY1N0YWNrLFxuICAgICAgdGFibGVEYXRhLnRhYmxlTmFtZSxcbiAgICAgIHRhYmxlUHJvcHMsXG4gICAgKTtcblxuICAgIHRhYmxlRGF0YS5sb2NhbFNlY29uZGFyeUluZGV4ZXMuZm9yRWFjaCgobHNpKSA9PiB7XG4gICAgICB0YWJsZS5hZGRMb2NhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgICAgaW5kZXhOYW1lOiBsc2kuaW5kZXhOYW1lLFxuICAgICAgICBzb3J0S2V5OiB7XG4gICAgICAgICAgbmFtZTogbHNpLnNvcnRLZXkubmFtZSxcbiAgICAgICAgICB0eXBlOiB0aGlzLmNvbnZlcnRBdHRyaWJ1dGVUeXBlKGxzaS5zb3J0S2V5LnR5cGUpLFxuICAgICAgICB9LFxuICAgICAgICBwcm9qZWN0aW9uVHlwZTogdGhpcy5jb252ZXJ0UHJvamVjdGlvblR5cGUoXG4gICAgICAgICAgbHNpLnByb2plY3Rpb24uUHJvamVjdGlvblR5cGUsXG4gICAgICAgICksXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIHRhYmxlRGF0YS5nbG9iYWxTZWNvbmRhcnlJbmRleGVzLmZvckVhY2goKGdzaSkgPT4ge1xuICAgICAgdGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgICBpbmRleE5hbWU6IGdzaS5pbmRleE5hbWUsXG4gICAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICAgIG5hbWU6IGdzaS5wYXJ0aXRpb25LZXkubmFtZSxcbiAgICAgICAgICB0eXBlOiB0aGlzLmNvbnZlcnRBdHRyaWJ1dGVUeXBlKGdzaS5wYXJ0aXRpb25LZXkudHlwZSksXG4gICAgICAgIH0sXG4gICAgICAgIHNvcnRLZXk6IGdzaS5zb3J0S2V5ICYmIGdzaS5zb3J0S2V5Lm5hbWVcbiAgICAgICAgICA/IHtcbiAgICAgICAgICAgIG5hbWU6IGdzaS5zb3J0S2V5Lm5hbWUsXG4gICAgICAgICAgICB0eXBlOiB0aGlzLmNvbnZlcnRBdHRyaWJ1dGVUeXBlKGdzaS5zb3J0S2V5LnR5cGUpLFxuICAgICAgICAgIH0gOiB1bmRlZmluZWQsXG4gICAgICAgIHByb2plY3Rpb25UeXBlOiB0aGlzLmNvbnZlcnRQcm9qZWN0aW9uVHlwZShcbiAgICAgICAgICBnc2kucHJvamVjdGlvbi5Qcm9qZWN0aW9uVHlwZSxcbiAgICAgICAgKSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHRhYmxlO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgdGhlIHN5bmMgdGFibGUgZm9yIEFtcGxpZnkgRGF0YVN0b3JlXG4gICAqIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9hcHBzeW5jL2xhdGVzdC9kZXZndWlkZS9jb25mbGljdC1kZXRlY3Rpb24tYW5kLXN5bmMuaHRtbFxuICAgKiBAcGFyYW0gdGFibGVEYXRhIFRoZSBDZGtUcmFuc2Zvcm1lciB0YWJsZSBpbmZvcm1hdGlvblxuICAgKi9cbiAgcHJpdmF0ZSBjcmVhdGVTeW5jVGFibGUodGFibGVEYXRhOiBDZGtUcmFuc2Zvcm1lclRhYmxlKTogVGFibGUge1xuICAgIHJldHVybiBuZXcgVGFibGUodGhpcywgJ2FwcHN5bmMtYXBpLXN5bmMtdGFibGUnLCB7XG4gICAgICBiaWxsaW5nTW9kZTogQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgcGFydGl0aW9uS2V5OiB7XG4gICAgICAgIG5hbWU6IHRhYmxlRGF0YS5wYXJ0aXRpb25LZXkubmFtZSxcbiAgICAgICAgdHlwZTogdGhpcy5jb252ZXJ0QXR0cmlidXRlVHlwZSh0YWJsZURhdGEucGFydGl0aW9uS2V5LnR5cGUpLFxuICAgICAgfSxcbiAgICAgIHNvcnRLZXk6IHtcbiAgICAgICAgbmFtZTogdGFibGVEYXRhLnNvcnRLZXkhLm5hbWUsIC8vIFdlIGtub3cgaXQgaGFzIGEgc29ydGtleSBiZWNhdXNlIHdlIGZvcmNlZCBpdCB0b1xuICAgICAgICB0eXBlOiB0aGlzLmNvbnZlcnRBdHRyaWJ1dGVUeXBlKHRhYmxlRGF0YS5zb3J0S2V5IS50eXBlKSwgLy8gV2Uga25vdyBpdCBoYXMgYSBzb3J0a2V5IGJlY2F1c2Ugd2UgZm9yY2VkIGl0IHRvXG4gICAgICB9LFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogdGFibGVEYXRhLnR0bD8uYXR0cmlidXRlTmFtZSB8fCAnX3R0bCcsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGNvbnZlcnRBdHRyaWJ1dGVUeXBlKHR5cGU6IHN0cmluZyk6IEF0dHJpYnV0ZVR5cGUge1xuICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgY2FzZSAnTic6XG4gICAgICAgIHJldHVybiBBdHRyaWJ1dGVUeXBlLk5VTUJFUjtcbiAgICAgIGNhc2UgJ0InOlxuICAgICAgICByZXR1cm4gQXR0cmlidXRlVHlwZS5CSU5BUlk7XG4gICAgICBjYXNlICdTJzogLy8gU2FtZSBhcyBkZWZhdWx0XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4gQXR0cmlidXRlVHlwZS5TVFJJTkc7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBjb252ZXJ0UHJvamVjdGlvblR5cGUodHlwZTogc3RyaW5nKTogUHJvamVjdGlvblR5cGUge1xuICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgY2FzZSAnSU5DTFVERSc6XG4gICAgICAgIHJldHVybiBQcm9qZWN0aW9uVHlwZS5JTkNMVURFO1xuICAgICAgY2FzZSAnS0VZU19PTkxZJzpcbiAgICAgICAgcmV0dXJuIFByb2plY3Rpb25UeXBlLktFWVNfT05MWTtcbiAgICAgIGNhc2UgJ0FMTCc6IC8vIFNhbWUgYXMgZGVmYXVsdFxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcmV0dXJuIFByb2plY3Rpb25UeXBlLkFMTDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUh0dHBSZXNvbHZlcnMoKSB7XG4gICAgZm9yIChjb25zdCBbZW5kcG9pbnQsIGh0dHBSZXNvbHZlcnNdIG9mIE9iamVjdC5lbnRyaWVzKFxuICAgICAgdGhpcy5odHRwUmVzb2x2ZXJzLFxuICAgICkpIHtcbiAgICAgIGNvbnN0IHN0cmlwcGVkRW5kcG9pbnQgPSBlbmRwb2ludC5yZXBsYWNlKC9bXl8wLTlBLVphLXpdL2csICcnKTtcbiAgICAgIGNvbnN0IGh0dHBEYXRhU291cmNlID0gdGhpcy5hcHBzeW5jQVBJLmFkZEh0dHBEYXRhU291cmNlKFxuICAgICAgICBgJHtzdHJpcHBlZEVuZHBvaW50fWAsXG4gICAgICAgIGVuZHBvaW50LFxuICAgICAgKTtcblxuICAgICAgaHR0cFJlc29sdmVycy5mb3JFYWNoKChyZXNvbHZlcjogQ2RrVHJhbnNmb3JtZXJIdHRwUmVzb2x2ZXIpID0+IHtcbiAgICAgICAgbmV3IFJlc29sdmVyKFxuICAgICAgICAgIHRoaXMubmVzdGVkQXBwc3luY1N0YWNrLFxuICAgICAgICAgIGAke3Jlc29sdmVyLnR5cGVOYW1lfS0ke3Jlc29sdmVyLmZpZWxkTmFtZX0tcmVzb2x2ZXJgLFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGFwaTogdGhpcy5hcHBzeW5jQVBJLFxuICAgICAgICAgICAgdHlwZU5hbWU6IHJlc29sdmVyLnR5cGVOYW1lLFxuICAgICAgICAgICAgZmllbGROYW1lOiByZXNvbHZlci5maWVsZE5hbWUsXG4gICAgICAgICAgICBkYXRhU291cmNlOiBodHRwRGF0YVNvdXJjZSxcbiAgICAgICAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IE1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKFxuICAgICAgICAgICAgICByZXNvbHZlci5kZWZhdWx0UmVxdWVzdE1hcHBpbmdUZW1wbGF0ZSxcbiAgICAgICAgICAgICksXG4gICAgICAgICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoXG4gICAgICAgICAgICAgIHJlc29sdmVyLmRlZmF1bHRSZXNwb25zZU1hcHBpbmdUZW1wbGF0ZSxcbiAgICAgICAgICAgICksXG4gICAgICAgICAgfSxcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUaGlzIHRha2VzIG9uZSBvZiB0aGUgYXV0b2dlbmVyYXRlZCBwb2xpY2llcyBmcm9tIEFXUyBhbmQgYnVpbGRzIHRoZSBsaXN0IG9mIEFSTnMgZm9yIGdyYW50aW5nIEdyYXBoUUwgYWNjZXNzIGxhdGVyXG4gICAqIEBwYXJhbSBwb2xpY3kgVGhlIGF1dG8gZ2VuZXJhdGVkIHBvbGljeSBmcm9tIHRoZSBBcHBTeW5jIFRyYW5zZm9ybWVyc1xuICAgKiBAcmV0dXJucyBBbiBhcnJheSBvZiByZXNvdXJjZSBhcm5zIGZvciB1c2Ugd2l0aCBncmFudHNcbiAgICovXG4gIHByaXZhdGUgZ2V0UmVzb3VyY2VzRnJvbUdlbmVyYXRlZFJvbGVQb2xpY3kocG9saWN5PzogUmVzb3VyY2UpOiBzdHJpbmdbXSB7XG4gICAgaWYgKCFwb2xpY3k/LlByb3BlcnRpZXM/LlBvbGljeURvY3VtZW50Py5TdGF0ZW1lbnQpIHJldHVybiBbXTtcblxuICAgIGNvbnN0IHsgcmVnaW9uLCBhY2NvdW50IH0gPSB0aGlzLm5lc3RlZEFwcHN5bmNTdGFjaztcblxuICAgIGNvbnN0IHJlc29sdmVkUmVzb3VyY2VzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGZvciAoY29uc3Qgc3RhdGVtZW50IG9mIHBvbGljeS5Qcm9wZXJ0aWVzLlBvbGljeURvY3VtZW50LlN0YXRlbWVudCkge1xuICAgICAgY29uc3QgeyBSZXNvdXJjZTogcmVzb3VyY2VzID0gW10gfSA9IHN0YXRlbWVudCA/PyB7fTtcbiAgICAgIGZvciAoY29uc3QgcmVzb3VyY2Ugb2YgcmVzb3VyY2VzKSB7XG4gICAgICAgIGNvbnN0IHN1YnMgPSByZXNvdXJjZVsnRm46OlN1YiddWzFdO1xuICAgICAgICBjb25zdCB7IHR5cGVOYW1lLCBmaWVsZE5hbWUgfSA9IHN1YnMgPz8ge307XG4gICAgICAgIGlmIChmaWVsZE5hbWUpIHtcbiAgICAgICAgICByZXNvbHZlZFJlc291cmNlcy5wdXNoKGBhcm46YXdzOmFwcHN5bmM6JHtyZWdpb259OiR7YWNjb3VudH06YXBpcy8ke3RoaXMuYXBwc3luY0FQSS5hcGlJZH0vdHlwZXMvJHt0eXBlTmFtZX0vZmllbGRzLyR7ZmllbGROYW1lfWApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc29sdmVkUmVzb3VyY2VzLnB1c2goYGFybjphd3M6YXBwc3luYzoke3JlZ2lvbn06JHthY2NvdW50fTphcGlzLyR7dGhpcy5hcHBzeW5jQVBJLmFwaUlkfS90eXBlcy8ke3R5cGVOYW1lfS8qYCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzb2x2ZWRSZXNvdXJjZXM7XG4gIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyBhZGRMYW1iZGFEYXRhU291cmNlQW5kUmVzb2x2ZXJzKFxuICAgIGZ1bmN0aW9uTmFtZTogc3RyaW5nLFxuICAgIGlkOiBzdHJpbmcsXG4gICAgbGFtYmRhRnVuY3Rpb246IElGdW5jdGlvbixcbiAgICBvcHRpb25zPzogRGF0YVNvdXJjZU9wdGlvbnMsXG4gICk6IExhbWJkYURhdGFTb3VyY2Uge1xuICAgIGNvbnN0IGZ1bmN0aW9uRGF0YVNvdXJjZSA9IHRoaXMuYXBwc3luY0FQSS5hZGRMYW1iZGFEYXRhU291cmNlKFxuICAgICAgaWQsXG4gICAgICBsYW1iZGFGdW5jdGlvbixcbiAgICAgIG9wdGlvbnMsXG4gICAgKTtcblxuICAgIGZvciAoY29uc3QgcmVzb2x2ZXIgb2YgdGhpcy5mdW5jdGlvblJlc29sdmVyc1tmdW5jdGlvbk5hbWVdKSB7XG4gICAgICBuZXcgUmVzb2x2ZXIoXG4gICAgICAgIHRoaXMubmVzdGVkQXBwc3luY1N0YWNrLFxuICAgICAgICBgJHtyZXNvbHZlci50eXBlTmFtZX0tJHtyZXNvbHZlci5maWVsZE5hbWV9LXJlc29sdmVyYCxcbiAgICAgICAge1xuICAgICAgICAgIGFwaTogdGhpcy5hcHBzeW5jQVBJLFxuICAgICAgICAgIHR5cGVOYW1lOiByZXNvbHZlci50eXBlTmFtZSxcbiAgICAgICAgICBmaWVsZE5hbWU6IHJlc29sdmVyLmZpZWxkTmFtZSxcbiAgICAgICAgICBkYXRhU291cmNlOiBmdW5jdGlvbkRhdGFTb3VyY2UsXG4gICAgICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoXG4gICAgICAgICAgICByZXNvbHZlci5kZWZhdWx0UmVxdWVzdE1hcHBpbmdUZW1wbGF0ZSxcbiAgICAgICAgICApLFxuICAgICAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBNYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhcbiAgICAgICAgICAgIHJlc29sdmVyLmRlZmF1bHRSZXNwb25zZU1hcHBpbmdUZW1wbGF0ZSxcbiAgICAgICAgICApLCAvLyBUaGlzIGRlZmF1bHRzIHRvIGFsbG93IGVycm9ycyB0byByZXR1cm4gdG8gdGhlIGNsaWVudCBpbnN0ZWFkIG9mIHRocm93aW5nXG4gICAgICAgIH0sXG4gICAgICApO1xuICAgIH1cblxuICAgIHJldHVybiBmdW5jdGlvbkRhdGFTb3VyY2U7XG4gIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICBwdWJsaWMgYWRkRHluYW1vREJTdHJlYW0ocHJvcHM6IER5bmFtb0RCU3RyZWFtUHJvcHMpOiBzdHJpbmcge1xuICAgIGNvbnN0IHRhYmxlTmFtZSA9IGAke3Byb3BzLm1vZGVsVHlwZU5hbWV9VGFibGVgO1xuICAgIGNvbnN0IHRhYmxlID0gdGhpcy50YWJsZU1hcFt0YWJsZU5hbWVdO1xuICAgIGlmICghdGFibGUpIHRocm93IG5ldyBFcnJvcihgVGFibGUgd2l0aCBuYW1lICcke3RhYmxlTmFtZX0nIG5vdCBmb3VuZC5gKTtcblxuICAgIGNvbnN0IGNmblRhYmxlID0gdGFibGUubm9kZS5kZWZhdWx0Q2hpbGQgYXMgQ2ZuVGFibGU7XG4gICAgY2ZuVGFibGUuc3RyZWFtU3BlY2lmaWNhdGlvbiA9IHtcbiAgICAgIHN0cmVhbVZpZXdUeXBlOiBwcm9wcy5zdHJlYW1WaWV3VHlwZSxcbiAgICB9O1xuXG4gICAgcmV0dXJuIGNmblRhYmxlLmF0dHJTdHJlYW1Bcm47XG4gIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyBncmFudFB1YmxpYyhncmFudGVlOiBJR3JhbnRhYmxlKTogR3JhbnQge1xuICAgIHJldHVybiBHcmFudC5hZGRUb1ByaW5jaXBhbCh7XG4gICAgICBncmFudGVlLFxuICAgICAgYWN0aW9uczogWydhcHBzeW5jOkdyYXBoUUwnXSxcbiAgICAgIHJlc291cmNlQXJuczogdGhpcy5wdWJsaWNSZXNvdXJjZUFybnMsXG4gICAgICBzY29wZTogdGhpcyxcbiAgICB9KTtcbiAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyBncmFudFByaXZhdGUoZ3JhbnRlZTogSUdyYW50YWJsZSk6IEdyYW50IHtcbiAgICByZXR1cm4gR3JhbnQuYWRkVG9QcmluY2lwYWwoe1xuICAgICAgZ3JhbnRlZSxcbiAgICAgIGFjdGlvbnM6IFsnYXBwc3luYzpHcmFwaFFMJ10sXG4gICAgICByZXNvdXJjZUFybnM6IHRoaXMucHJpdmF0ZVJlc291cmNlQXJucyxcbiAgICB9KTtcbiAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIER5bmFtb0RCU3RyZWFtUHJvcHMge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcmVhZG9ubHkgbW9kZWxUeXBlTmFtZTogc3RyaW5nO1xuICByZWFkb25seSBzdHJlYW1WaWV3VHlwZTogU3RyZWFtVmlld1R5cGU7XG59XG4iXX0=