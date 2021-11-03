"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppSyncTransformer = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const fs = require("fs");
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
            customVtlTransformerRootDirectory: props.customVtlTransformerRootDirectory,
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
                const resolver = resolvers[resolverKey];
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
                const resolver = resolvers.gsi[resolverKey];
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
     * (experimental) Allows for overriding the generated request and response mapping templates.
     *
     * @experimental
     */
    overrideResolver(props) {
        const resolver = this.nestedAppsyncStack.node.tryFindChild(`${props.typeName}-${props.fieldName}-resolver`);
        if (!resolver)
            throw new Error(`Resolver with typeName '${props.typeName}' and fieldName '${props.fieldName}' not found`);
        const cfnResolver = resolver.node.defaultChild;
        if (!cfnResolver)
            throw new Error(`Resolver with typeName '${props.typeName}' and fieldName '${props.fieldName}' not found`);
        if (props.requestMappingTemplateFile) {
            cfnResolver.requestMappingTemplate = fs.readFileSync(props.requestMappingTemplateFile).toString('utf-8');
        }
        if (props.responseMappingTemplateFile) {
            cfnResolver.responseMappingTemplate = fs.readFileSync(props.responseMappingTemplateFile).toString('utf-8');
        }
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
AppSyncTransformer[_a] = { fqn: "cdk-appsync-transformer.AppSyncTransformer", version: "0.0.0" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwc3luYy10cmFuc2Zvcm1lci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9hcHBzeW5jLXRyYW5zZm9ybWVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEseUJBQXlCO0FBQ3pCLHNEQWE4QjtBQUU5Qix3REFRK0I7QUFDL0IsOENBQThFO0FBRTlFLHdDQUFrRTtBQVdsRSx5RUFHMEM7QUE2QzFDLE1BQU0sMEJBQTBCLEdBQXdCO0lBQ3RELG9CQUFvQixFQUFFO1FBQ3BCLGlCQUFpQixFQUFFLCtCQUFpQixDQUFDLE9BQU87UUFDNUMsWUFBWSxFQUFFO1lBQ1osV0FBVyxFQUFFLHVDQUF1QztZQUNwRCxJQUFJLEVBQUUsS0FBSztTQUNaO0tBQ0Y7Q0FDRixDQUFDOzs7Ozs7QUFHRixNQUFhLGtCQUFtQixTQUFRLGdCQUFTOzs7O0lBc0MvQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQThCOztRQUN0RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDO1FBQ25CLElBQUksQ0FBQyxRQUFRLEdBQUcsRUFBRSxDQUFDO1FBQ25CLElBQUksQ0FBQyxhQUFhLEdBQUcsRUFBRSxDQUFDO1FBQ3hCLElBQUksQ0FBQyxhQUFhLEdBQUcsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDO1FBQ25FLElBQUksQ0FBQyxtQkFBbUIsU0FBRyxLQUFLLENBQUMsK0JBQStCLG1DQUFJLEtBQUssQ0FBQztRQUUxRSxNQUFNLHdCQUF3QixHQUEyQjtZQUN2RCxVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVU7WUFDNUIsV0FBVyxRQUFFLEtBQUssQ0FBQyxXQUFXLG1DQUFJLEtBQUs7WUFDdkMsaUNBQWlDLEVBQUUsS0FBSyxDQUFDLGlDQUFpQztTQUMzRSxDQUFDO1FBRUYsMENB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QUEyQixFQUFFO1lBQ3JDLFdBQVcsQ0FBQyx1QkFBdUIsR0FBRyxFQUFFLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQywyQkFBMkIsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQztTQUM1RztJQUNILENBQUM7Ozs7Ozs7Ozs7SUFHTSxXQUFXLENBQUMsT0FBbUI7UUFDcEMsT0FBTyxlQUFLLENBQUMsY0FBYyxDQUFDO1lBQzFCLE9BQU87WUFDUCxPQUFPLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQztZQUM1QixZQUFZLEVBQUUsSUFBSSxDQUFDLGtCQUFrQjtZQUNyQyxLQUFLLEVBQUUsSUFBSTtTQUNaLENBQUMsQ0FBQztJQUNMLENBQUM7Ozs7Ozs7OztJQUdNLFlBQVksQ0FBQyxPQUFtQjtRQUNyQyxPQUFPLGVBQUssQ0FBQyxjQUFjLENBQUM7WUFDMUIsT0FBTztZQUNQLE9BQU8sRUFBRSxDQUFDLGlCQUFpQixDQUFDO1lBQzVCLFlBQVksRUFBRSxJQUFJLENBQUMsbUJBQW1CO1NBQ3ZDLENBQUMsQ0FBQztJQUNMLENBQUM7O0FBN2hCSCxnREE4aEJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IHtcbiAgR3JhcGhxbEFwaSxcbiAgQXV0aG9yaXphdGlvblR5cGUsXG4gIEZpZWxkTG9nTGV2ZWwsXG4gIE1hcHBpbmdUZW1wbGF0ZSxcbiAgQ2ZuRGF0YVNvdXJjZSxcbiAgUmVzb2x2ZXIsXG4gIENmblJlc29sdmVyLFxuICBBdXRob3JpemF0aW9uQ29uZmlnLFxuICBTY2hlbWEsXG4gIERhdGFTb3VyY2VPcHRpb25zLFxuICBMYW1iZGFEYXRhU291cmNlLFxuICBEeW5hbW9EYkRhdGFTb3VyY2UsXG59IGZyb20gJ0Bhd3MtY2RrL2F3cy1hcHBzeW5jJztcblxuaW1wb3J0IHtcbiAgQ2ZuVGFibGUsXG4gIFRhYmxlLFxuICBBdHRyaWJ1dGVUeXBlLFxuICBQcm9qZWN0aW9uVHlwZSxcbiAgQmlsbGluZ01vZGUsXG4gIFN0cmVhbVZpZXdUeXBlLFxuICBUYWJsZVByb3BzLFxufSBmcm9tICdAYXdzLWNkay9hd3MtZHluYW1vZGInO1xuaW1wb3J0IHsgRWZmZWN0LCBHcmFudCwgSUdyYW50YWJsZSwgUG9saWN5U3RhdGVtZW50IH0gZnJvbSAnQGF3cy1jZGsvYXdzLWlhbSc7XG5pbXBvcnQgeyBJRnVuY3Rpb24gfSBmcm9tICdAYXdzLWNkay9hd3MtbGFtYmRhJztcbmltcG9ydCB7IENvbnN0cnVjdCwgTmVzdGVkU3RhY2ssIENmbk91dHB1dCB9IGZyb20gJ0Bhd3MtY2RrL2NvcmUnO1xuXG5pbXBvcnQge1xuICBDZGtUcmFuc2Zvcm1lclJlc29sdmVyLFxuICBDZGtUcmFuc2Zvcm1lckZ1bmN0aW9uUmVzb2x2ZXIsXG4gIENka1RyYW5zZm9ybWVySHR0cFJlc29sdmVyLFxuICBDZGtUcmFuc2Zvcm1lclRhYmxlLFxuICBTY2hlbWFUcmFuc2Zvcm1lck91dHB1dHMsXG59IGZyb20gJy4vdHJhbnNmb3JtZXInO1xuaW1wb3J0IHsgUmVzb3VyY2UgfSBmcm9tICcuL3RyYW5zZm9ybWVyL3Jlc291cmNlJztcblxuaW1wb3J0IHtcbiAgU2NoZW1hVHJhbnNmb3JtZXIsXG4gIFNjaGVtYVRyYW5zZm9ybWVyUHJvcHMsXG59IGZyb20gJy4vdHJhbnNmb3JtZXIvc2NoZW1hLXRyYW5zZm9ybWVyJztcblxuZXhwb3J0IGludGVyZmFjZSBBcHBTeW5jVHJhbnNmb3JtZXJQcm9wcyB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IHNjaGVtYVBhdGg6IHN0cmluZztcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSBhdXRob3JpemF0aW9uQ29uZmlnPzogQXV0aG9yaXphdGlvbkNvbmZpZztcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IGFwaU5hbWU/OiBzdHJpbmc7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcmVhZG9ubHkgc3luY0VuYWJsZWQ/OiBib29sZWFuO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IGVuYWJsZUR5bmFtb1BvaW50SW5UaW1lUmVjb3Zlcnk/OiBib29sZWFuO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSBmaWVsZExvZ0xldmVsPzogRmllbGRMb2dMZXZlbDtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSB4cmF5RW5hYmxlZD86IGJvb2xlYW47XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IHRhYmxlTmFtZXM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSBkeW5hbW9EYlN0cmVhbUNvbmZpZz86IHsgW25hbWU6IHN0cmluZ106IFN0cmVhbVZpZXdUeXBlIH07XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcmVhZG9ubHkgbmVzdGVkU3RhY2tOYW1lPzogc3RyaW5nO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcmVhZG9ubHkgY3VzdG9tVnRsVHJhbnNmb3JtZXJSb290RGlyZWN0b3J5Pzogc3RyaW5nO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG5cbiAgcmVhZG9ubHkgcHJlQ2RrVHJhbnNmb3JtZXJzPzogYW55W107XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuXG4gIHJlYWRvbmx5IHBvc3RDZGtUcmFuc2Zvcm1lcnM/OiBhbnlbXTtcbn1cblxuY29uc3QgZGVmYXVsdEF1dGhvcml6YXRpb25Db25maWc6IEF1dGhvcml6YXRpb25Db25maWcgPSB7XG4gIGRlZmF1bHRBdXRob3JpemF0aW9uOiB7XG4gICAgYXV0aG9yaXphdGlvblR5cGU6IEF1dGhvcml6YXRpb25UeXBlLkFQSV9LRVksXG4gICAgYXBpS2V5Q29uZmlnOiB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0F1dG8gZ2VuZXJhdGVkIEFQSSBLZXkgZnJvbSBjb25zdHJ1Y3QnLFxuICAgICAgbmFtZTogJ2RldicsXG4gICAgfSxcbiAgfSxcbn07XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuZXhwb3J0IGNsYXNzIEFwcFN5bmNUcmFuc2Zvcm1lciBleHRlbmRzIENvbnN0cnVjdCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIHJlYWRvbmx5IGFwcHN5bmNBUEk6IEdyYXBocWxBcGk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyByZWFkb25seSBuZXN0ZWRBcHBzeW5jU3RhY2s6IE5lc3RlZFN0YWNrO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyByZWFkb25seSB0YWJsZU5hbWVNYXA6IHsgW25hbWU6IHN0cmluZ106IHN0cmluZyB9O1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICBwdWJsaWMgcmVhZG9ubHkgdGFibGVNYXA6IHsgW25hbWU6IHN0cmluZ106IFRhYmxlIH07XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyByZWFkb25seSBkYXRhc291cmNlTWFwOiB7IFtuYW1lOiBzdHJpbmddOiBEeW5hbW9EYkRhdGFTb3VyY2UgfTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICBwdWJsaWMgcmVhZG9ubHkgb3V0cHV0czogU2NoZW1hVHJhbnNmb3JtZXJPdXRwdXRzO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyByZWFkb25seSByZXNvbHZlcnM6IHsgW25hbWU6IHN0cmluZ106IENka1RyYW5zZm9ybWVyUmVzb2x2ZXIgfTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyByZWFkb25seSBmdW5jdGlvblJlc29sdmVyczoge1xuICAgIFtuYW1lOiBzdHJpbmddOiBDZGtUcmFuc2Zvcm1lckZ1bmN0aW9uUmVzb2x2ZXJbXTtcbiAgfTtcblxuICBwdWJsaWMgcmVhZG9ubHkgaHR0cFJlc29sdmVyczoge1xuICAgIFtuYW1lOiBzdHJpbmddOiBDZGtUcmFuc2Zvcm1lckh0dHBSZXNvbHZlcltdO1xuICB9O1xuXG4gIHByaXZhdGUgcHJvcHM6IEFwcFN5bmNUcmFuc2Zvcm1lclByb3BzXG4gIHByaXZhdGUgaXNTeW5jRW5hYmxlZDogYm9vbGVhbjtcbiAgcHJpdmF0ZSBzeW5jVGFibGU6IFRhYmxlIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHBvaW50SW5UaW1lUmVjb3Zlcnk6IGJvb2xlYW47XG4gIHByaXZhdGUgcmVhZG9ubHkgcHVibGljUmVzb3VyY2VBcm5zOiBzdHJpbmdbXTtcbiAgcHJpdmF0ZSByZWFkb25seSBwcml2YXRlUmVzb3VyY2VBcm5zOiBzdHJpbmdbXTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQXBwU3luY1RyYW5zZm9ybWVyUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgdGhpcy5wcm9wcyA9IHByb3BzO1xuICAgIHRoaXMudGFibGVNYXAgPSB7fTtcbiAgICB0aGlzLmRhdGFzb3VyY2VNYXAgPSB7fTtcbiAgICB0aGlzLmlzU3luY0VuYWJsZWQgPSBwcm9wcy5zeW5jRW5hYmxlZCA/IHByb3BzLnN5bmNFbmFibGVkIDogZmFsc2U7XG4gICAgdGhpcy5wb2ludEluVGltZVJlY292ZXJ5ID0gcHJvcHMuZW5hYmxlRHluYW1vUG9pbnRJblRpbWVSZWNvdmVyeSA/PyBmYWxzZTtcblxuICAgIGNvbnN0IHRyYW5zZm9ybWVyQ29uZmlndXJhdGlvbjogU2NoZW1hVHJhbnNmb3JtZXJQcm9wcyA9IHtcbiAgICAgIHNjaGVtYVBhdGg6IHByb3BzLnNjaGVtYVBhdGgsXG4gICAgICBzeW5jRW5hYmxlZDogcHJvcHMuc3luY0VuYWJsZWQgPz8gZmFsc2UsXG4gICAgICBjdXN0b21WdGxUcmFuc2Zvcm1lclJvb3REaXJlY3Rvcnk6IHByb3BzLmN1c3RvbVZ0bFRyYW5zZm9ybWVyUm9vdERpcmVjdG9yeSxcbiAgICB9O1xuXG4gICAgLy8gQ29tYmluZSB0aGUgYXJyYXlzIHNvIHdlIG9ubHkgbG9vcCBvbmNlXG4gICAgLy8gVGVzdCBlYWNoIHRyYW5zZm9ybWVyIHRvIHNlZSBpZiBpdCBpbXBsZW1lbnRzIElUcmFuc2Zvcm1lclxuICAgIGNvbnN0IGFsbEN1c3RvbVRyYW5zZm9ybWVycyA9IFsuLi5wcm9wcy5wcmVDZGtUcmFuc2Zvcm1lcnMgPz8gW10sIC4uLnByb3BzLnBvc3RDZGtUcmFuc2Zvcm1lcnMgPz8gW11dO1xuICAgIGlmIChhbGxDdXN0b21UcmFuc2Zvcm1lcnMgJiYgYWxsQ3VzdG9tVHJhbnNmb3JtZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgIGFsbEN1c3RvbVRyYW5zZm9ybWVycy5mb3JFYWNoKHRyYW5zZm9ybWVyID0+IHtcbiAgICAgICAgaWYgKHRyYW5zZm9ybWVyICYmICF0aGlzLmltcGxlbWVudHNJVHJhbnNmb3JtZXIodHJhbnNmb3JtZXIpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUcmFuc2Zvcm1lciBkb2VzIG5vdCBpbXBsZW1lbnQgSVRyYW5zZm9ybWVyIGZyb20gZ3JhcGhxbC10cmFuc2Zvcm1lci1jb3JlOiAke3RyYW5zZm9ybWVyfWApO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCB0cmFuc2Zvcm1lciA9IG5ldyBTY2hlbWFUcmFuc2Zvcm1lcih0cmFuc2Zvcm1lckNvbmZpZ3VyYXRpb24pO1xuICAgIHRoaXMub3V0cHV0cyA9IHRyYW5zZm9ybWVyLnRyYW5zZm9ybShwcm9wcy5wcmVDZGtUcmFuc2Zvcm1lcnMsIHByb3BzLnBvc3RDZGtUcmFuc2Zvcm1lcnMpO1xuICAgIGNvbnN0IHJlc29sdmVycyA9IHRyYW5zZm9ybWVyLmdldFJlc29sdmVycygpO1xuXG4gICAgdGhpcy5mdW5jdGlvblJlc29sdmVycyA9IHRoaXMub3V0cHV0cy5mdW5jdGlvblJlc29sdmVycyA/PyB7fTtcblxuICAgIC8vIFJlbW92ZSBhbnkgZnVuY3Rpb24gcmVzb2x2ZXJzIGZyb20gdGhlIHRvdGFsIGxpc3Qgb2YgcmVzb2x2ZXJzXG4gICAgLy8gT3RoZXJ3aXNlIGl0IHdpbGwgYWRkIHRoZW0gdHdpY2VcbiAgICBmb3IgKGNvbnN0IFtfLCBmdW5jdGlvblJlc29sdmVyc10gb2YgT2JqZWN0LmVudHJpZXMoXG4gICAgICB0aGlzLmZ1bmN0aW9uUmVzb2x2ZXJzLFxuICAgICkpIHtcbiAgICAgIGZ1bmN0aW9uUmVzb2x2ZXJzLmZvckVhY2goKHJlc29sdmVyKSA9PiB7XG4gICAgICAgIHN3aXRjaCAocmVzb2x2ZXIudHlwZU5hbWUpIHtcbiAgICAgICAgICBjYXNlICdRdWVyeSc6XG4gICAgICAgICAgY2FzZSAnTXV0YXRpb24nOlxuICAgICAgICAgIGNhc2UgJ1N1YnNjcmlwdGlvbic6XG4gICAgICAgICAgICBkZWxldGUgcmVzb2x2ZXJzW3Jlc29sdmVyLmZpZWxkTmFtZV07XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdGhpcy5odHRwUmVzb2x2ZXJzID0gdGhpcy5vdXRwdXRzLmh0dHBSZXNvbHZlcnMgPz8ge307XG5cbiAgICAvLyBSZW1vdmUgYW55IGh0dHAgcmVzb2x2ZXJzIGZyb20gdGhlIHRvdGFsIGxpc3Qgb2YgcmVzb2x2ZXJzXG4gICAgLy8gT3RoZXJ3aXNlIGl0IHdpbGwgYWRkIHRoZW0gdHdpY2VcbiAgICBmb3IgKGNvbnN0IFtfLCBodHRwUmVzb2x2ZXJzXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmh0dHBSZXNvbHZlcnMpKSB7XG4gICAgICBodHRwUmVzb2x2ZXJzLmZvckVhY2goKHJlc29sdmVyKSA9PiB7XG4gICAgICAgIHN3aXRjaCAocmVzb2x2ZXIudHlwZU5hbWUpIHtcbiAgICAgICAgICBjYXNlICdRdWVyeSc6XG4gICAgICAgICAgY2FzZSAnTXV0YXRpb24nOlxuICAgICAgICAgIGNhc2UgJ1N1YnNjcmlwdGlvbic6XG4gICAgICAgICAgICBkZWxldGUgcmVzb2x2ZXJzW3Jlc29sdmVyLmZpZWxkTmFtZV07XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdGhpcy5yZXNvbHZlcnMgPSByZXNvbHZlcnM7XG5cbiAgICB0aGlzLm5lc3RlZEFwcHN5bmNTdGFjayA9IG5ldyBOZXN0ZWRTdGFjayh0aGlzLCBwcm9wcy5uZXN0ZWRTdGFja05hbWUgPz8gJ2FwcHN5bmMtbmVzdGVkLXN0YWNrJyk7XG5cbiAgICAvLyBBcHBTeW5jXG4gICAgdGhpcy5hcHBzeW5jQVBJID0gbmV3IEdyYXBocWxBcGkodGhpcy5uZXN0ZWRBcHBzeW5jU3RhY2ssIGAke2lkfS1hcGlgLCB7XG4gICAgICBuYW1lOiBwcm9wcy5hcGlOYW1lID8gcHJvcHMuYXBpTmFtZSA6IGAke2lkfS1hcGlgLFxuICAgICAgYXV0aG9yaXphdGlvbkNvbmZpZzogcHJvcHMuYXV0aG9yaXphdGlvbkNvbmZpZ1xuICAgICAgICA/IHByb3BzLmF1dGhvcml6YXRpb25Db25maWdcbiAgICAgICAgOiBkZWZhdWx0QXV0aG9yaXphdGlvbkNvbmZpZyxcbiAgICAgIGxvZ0NvbmZpZzoge1xuICAgICAgICBmaWVsZExvZ0xldmVsOiBwcm9wcy5maWVsZExvZ0xldmVsXG4gICAgICAgICAgPyBwcm9wcy5maWVsZExvZ0xldmVsXG4gICAgICAgICAgOiBGaWVsZExvZ0xldmVsLk5PTkUsXG4gICAgICB9LFxuICAgICAgc2NoZW1hOiBTY2hlbWEuZnJvbUFzc2V0KCcuL2FwcHN5bmMvc2NoZW1hLmdyYXBocWwnKSxcbiAgICAgIHhyYXlFbmFibGVkOiBwcm9wcy54cmF5RW5hYmxlZCA/PyBmYWxzZSxcbiAgICB9KTtcblxuICAgIGxldCB0YWJsZURhdGEgPSB0aGlzLm91dHB1dHMuY2RrVGFibGVzID8/IHt9O1xuXG4gICAgLy8gQ2hlY2sgdG8gc2VlIGlmIHN5bmMgaXMgZW5hYmxlZFxuICAgIGlmICh0YWJsZURhdGEuRGF0YVN0b3JlKSB7XG4gICAgICB0aGlzLmlzU3luY0VuYWJsZWQgPSB0cnVlO1xuICAgICAgdGhpcy5zeW5jVGFibGUgPSB0aGlzLmNyZWF0ZVN5bmNUYWJsZSh0YWJsZURhdGEuRGF0YVN0b3JlKTtcbiAgICAgIGRlbGV0ZSB0YWJsZURhdGEuRGF0YVN0b3JlOyAvLyBXZSBkb24ndCB3YW50IHRvIGNyZWF0ZSB0aGlzIGFnYWluIGJlbG93IHNvIHJlbW92ZSBpdCBmcm9tIHRoZSB0YWJsZURhdGEgbWFwXG4gICAgfVxuXG4gICAgdGhpcy50YWJsZU5hbWVNYXAgPSB0aGlzLmNyZWF0ZVRhYmxlc0FuZFJlc29sdmVycyh0YWJsZURhdGEsIHJlc29sdmVycywgcHJvcHMudGFibGVOYW1lcyk7XG4gICAgaWYgKHRoaXMub3V0cHV0cy5ub25lUmVzb2x2ZXJzKSB7XG4gICAgICB0aGlzLmNyZWF0ZU5vbmVEYXRhU291cmNlQW5kUmVzb2x2ZXJzKFxuICAgICAgICB0aGlzLm91dHB1dHMubm9uZVJlc29sdmVycyxcbiAgICAgICAgcmVzb2x2ZXJzLFxuICAgICAgKTtcbiAgICB9XG4gICAgdGhpcy5jcmVhdGVIdHRwUmVzb2x2ZXJzKCk7XG5cbiAgICB0aGlzLnB1YmxpY1Jlc291cmNlQXJucyA9IHRoaXMuZ2V0UmVzb3VyY2VzRnJvbUdlbmVyYXRlZFJvbGVQb2xpY3kodHJhbnNmb3JtZXIudW5hdXRoUm9sZVBvbGljeSk7XG4gICAgdGhpcy5wcml2YXRlUmVzb3VyY2VBcm5zID0gdGhpcy5nZXRSZXNvdXJjZXNGcm9tR2VuZXJhdGVkUm9sZVBvbGljeSh0cmFuc2Zvcm1lci5hdXRoUm9sZVBvbGljeSk7XG5cbiAgICAvLyBPdXRwdXRzIHNvIHdlIGNhbiBnZW5lcmF0ZSBleHBvcnRzXG4gICAgbmV3IENmbk91dHB1dChzY29wZSwgJ2FwcHN5bmNHcmFwaFFMRW5kcG9pbnRPdXRwdXQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hcHBzeW5jQVBJLmdyYXBocWxVcmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ091dHB1dCBmb3IgYXdzX2FwcHN5bmNfZ3JhcGhxbEVuZHBvaW50JyxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBncmFwaHFsLXRyYW5zZm9ybWVyLWNvcmUgbmVlZHMgdG8gYmUganNpaSBlbmFibGVkIHRvIHB1bGwgdGhlIElUcmFuc2Zvcm1lciBpbnRlcmZhY2UgY29ycmVjdGx5LlxuICAgKiBTaW5jZSBpdCdzIG5vdCBpbiBwZWVyIGRlcGVuZGVuY2llcyBpdCBkb2Vzbid0IHNob3cgdXAgaW4gdGhlIGpzaWkgZGVwcyBsaXN0LlxuICAgKiBTaW5jZSBpdCdzIG5vdCBqc2lpIGVuYWJsZWQgaXQgaGFzIHRvIGJlIGJ1bmRsZWQuXG4gICAqIFRoZSBwYWNrYWdlIGNhbid0IGJlIGluIEJPVEggcGVlciBhbmQgYnVuZGxlZCBkZXBlbmRlbmNpZXNcbiAgICogU28gd2UgZG8gYSBmYWtlIHRlc3QgdG8gbWFrZSBzdXJlIGl0IGltcGxlbWVudHMgdGhlc2UgYW5kIGhvcGUgZm9yIHRoZSBiZXN0XG4gICAqIEBwYXJhbSB0cmFuc2Zvcm1lclxuICAgKi9cbiAgcHJpdmF0ZSBpbXBsZW1lbnRzSVRyYW5zZm9ybWVyKHRyYW5zZm9ybWVyOiBhbnkpIHtcbiAgICByZXR1cm4gJ25hbWUnIGluIHRyYW5zZm9ybWVyXG4gICAgICAmJiAnZGlyZWN0aXZlJyBpbiB0cmFuc2Zvcm1lclxuICAgICAgJiYgJ3R5cGVEZWZpbml0aW9ucycgaW4gdHJhbnNmb3JtZXI7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBOT05FIGRhdGEgc291cmNlIGFuZCBhc3NvY2lhdGVkIHJlc29sdmVyc1xuICAgKiBAcGFyYW0gbm9uZVJlc29sdmVycyBUaGUgcmVzb2x2ZXJzIHRoYXQgYmVsb25nIHRvIHRoZSBub25lIGRhdGEgc291cmNlXG4gICAqIEBwYXJhbSByZXNvbHZlcnMgVGhlIHJlc29sdmVyIG1hcCBtaW51cyBmdW5jdGlvbiByZXNvbHZlcnNcbiAgICovXG4gIHByaXZhdGUgY3JlYXRlTm9uZURhdGFTb3VyY2VBbmRSZXNvbHZlcnMoXG4gICAgbm9uZVJlc29sdmVyczogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJSZXNvbHZlciB9LFxuICAgIHJlc29sdmVyczogYW55LFxuICApIHtcbiAgICBjb25zdCBub25lRGF0YVNvdXJjZSA9IHRoaXMuYXBwc3luY0FQSS5hZGROb25lRGF0YVNvdXJjZSgnTk9ORScpO1xuXG4gICAgT2JqZWN0LmtleXMobm9uZVJlc29sdmVycykuZm9yRWFjaCgocmVzb2x2ZXJLZXkpID0+IHtcbiAgICAgIGNvbnN0IHJlc29sdmVyID0gcmVzb2x2ZXJzW3Jlc29sdmVyS2V5XTtcbiAgICAgIG5ldyBSZXNvbHZlcihcbiAgICAgICAgdGhpcy5uZXN0ZWRBcHBzeW5jU3RhY2ssXG4gICAgICAgIGAke3Jlc29sdmVyLnR5cGVOYW1lfS0ke3Jlc29sdmVyLmZpZWxkTmFtZX0tcmVzb2x2ZXJgLFxuICAgICAgICB7XG4gICAgICAgICAgYXBpOiB0aGlzLmFwcHN5bmNBUEksXG4gICAgICAgICAgdHlwZU5hbWU6IHJlc29sdmVyLnR5cGVOYW1lLFxuICAgICAgICAgIGZpZWxkTmFtZTogcmVzb2x2ZXIuZmllbGROYW1lLFxuICAgICAgICAgIGRhdGFTb3VyY2U6IG5vbmVEYXRhU291cmNlLFxuICAgICAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IE1hcHBpbmdUZW1wbGF0ZS5mcm9tRmlsZShcbiAgICAgICAgICAgIHJlc29sdmVyLnJlcXVlc3RNYXBwaW5nVGVtcGxhdGUsXG4gICAgICAgICAgKSxcbiAgICAgICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogTWFwcGluZ1RlbXBsYXRlLmZyb21GaWxlKFxuICAgICAgICAgICAgcmVzb2x2ZXIucmVzcG9uc2VNYXBwaW5nVGVtcGxhdGUsXG4gICAgICAgICAgKSxcbiAgICAgICAgfSxcbiAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBlYWNoIGR5bmFtb2RiIHRhYmxlLCBnc2lzLCBkeW5hbW9kYiBkYXRhc291cmNlLCBhbmQgYXNzb2NpYXRlZCByZXNvbHZlcnNcbiAgICogSWYgc3luYyBpcyBlbmFibGVkIHRoZW4gVFRMIGNvbmZpZ3VyYXRpb24gaXMgYWRkZWRcbiAgICogUmV0dXJucyB0YWJsZU5hbWU6IHRhYmxlIG1hcCBpbiBjYXNlIGl0IGlzIG5lZWRlZCBmb3IgbGFtYmRhIGZ1bmN0aW9ucywgZXRjXG4gICAqIEBwYXJhbSB0YWJsZURhdGEgVGhlIENka1RyYW5zZm9ybWVyIHRhYmxlIGluZm9ybWF0aW9uXG4gICAqIEBwYXJhbSByZXNvbHZlcnMgVGhlIHJlc29sdmVyIG1hcCBtaW51cyBmdW5jdGlvbiByZXNvbHZlcnNcbiAgICovXG4gIHByaXZhdGUgY3JlYXRlVGFibGVzQW5kUmVzb2x2ZXJzKFxuICAgIHRhYmxlRGF0YTogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJUYWJsZSB9LFxuICAgIHJlc29sdmVyczogYW55LFxuICAgIHRhYmxlTmFtZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fSxcbiAgKTogeyBbbmFtZTogc3RyaW5nXTogc3RyaW5nIH0ge1xuICAgIGNvbnN0IHRhYmxlTmFtZU1hcDogYW55ID0ge307XG5cbiAgICBPYmplY3Qua2V5cyh0YWJsZURhdGEpLmZvckVhY2goKHRhYmxlS2V5KSA9PiB7XG4gICAgICBjb25zdCB0YWJsZU5hbWUgPSB0YWJsZU5hbWVzW3RhYmxlS2V5XSA/PyB1bmRlZmluZWQ7XG4gICAgICBjb25zdCB0YWJsZSA9IHRoaXMuY3JlYXRlVGFibGUodGFibGVEYXRhW3RhYmxlS2V5XSwgdGFibGVOYW1lKTtcbiAgICAgIHRoaXMudGFibGVNYXBbdGFibGVLZXldID0gdGFibGU7XG5cbiAgICAgIGNvbnN0IGRhdGFTb3VyY2UgPSB0aGlzLmFwcHN5bmNBUEkuYWRkRHluYW1vRGJEYXRhU291cmNlKHRhYmxlS2V5LCB0YWJsZSk7XG5cbiAgICAgIC8vIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9BV1NDbG91ZEZvcm1hdGlvbi9sYXRlc3QvVXNlckd1aWRlL2F3cy1wcm9wZXJ0aWVzLWFwcHN5bmMtZGF0YXNvdXJjZS1kZWx0YXN5bmNjb25maWcuaHRtbFxuXG4gICAgICBpZiAodGhpcy5pc1N5bmNFbmFibGVkICYmIHRoaXMuc3luY1RhYmxlKSB7XG4gICAgICAgIC8vQHRzLWlnbm9yZSAtIGRzIGlzIHRoZSBiYXNlIENmbkRhdGFTb3VyY2UgYW5kIHRoZSBkYiBjb25maWcgbmVlZHMgdG8gYmUgdmVyc2lvbmVkIC0gc2VlIENmbkRhdGFTb3VyY2VcbiAgICAgICAgZGF0YVNvdXJjZS5kcy5keW5hbW9EYkNvbmZpZy52ZXJzaW9uZWQgPSB0cnVlO1xuXG4gICAgICAgIC8vQHRzLWlnbm9yZSAtIGRzIGlzIHRoZSBiYXNlIENmbkRhdGFTb3VyY2UgLSBzZWUgQ2ZuRGF0YVNvdXJjZVxuICAgICAgICBkYXRhU291cmNlLmRzLmR5bmFtb0RiQ29uZmlnLmRlbHRhU3luY0NvbmZpZyA9IHtcbiAgICAgICAgICBiYXNlVGFibGVUdGw6ICc0MzIwMCcsIC8vIEdvdCB0aGlzIHZhbHVlIGZyb20gYW1wbGlmeSAtIDMwIGRheXMgaW4gbWludXRlc1xuICAgICAgICAgIGRlbHRhU3luY1RhYmxlTmFtZTogdGhpcy5zeW5jVGFibGUudGFibGVOYW1lLFxuICAgICAgICAgIGRlbHRhU3luY1RhYmxlVHRsOiAnMzAnLCAvLyBHb3QgdGhpcyB2YWx1ZSBmcm9tIGFtcGxpZnkgLSAzMCBtaW51dGVzXG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gTmVlZCB0byBhZGQgcGVybWlzc2lvbiBmb3Igb3VyIGRhdGFzb3VyY2Ugc2VydmljZSByb2xlIHRvIGFjY2VzcyB0aGUgc3luYyB0YWJsZVxuICAgICAgICBkYXRhU291cmNlLmdyYW50UHJpbmNpcGFsLmFkZFRvUG9saWN5KFxuICAgICAgICAgIG5ldyBQb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgZWZmZWN0OiBFZmZlY3QuQUxMT1csXG4gICAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAgICdkeW5hbW9kYjoqJywgLy8gVE9ETzogVGhpcyBtYXkgYmUgdG9vIHBlcm1pc3NpdmVcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLnN5bmNUYWJsZS50YWJsZUFybl0sXG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGR5bmFtb0RiQ29uZmlnID0gZGF0YVNvdXJjZS5kc1xuICAgICAgICAuZHluYW1vRGJDb25maWcgYXMgQ2ZuRGF0YVNvdXJjZS5EeW5hbW9EQkNvbmZpZ1Byb3BlcnR5O1xuICAgICAgdGFibGVOYW1lTWFwW3RhYmxlS2V5XSA9IGR5bmFtb0RiQ29uZmlnLnRhYmxlTmFtZTtcblxuICAgICAgLy9FeHBvc2UgZGF0YXNvdXJjZSB0byBzdXBwb3J0IGFkZGluZyBtdWx0aXBsZSByZXNvbHZlcnNcbiAgICAgIHRoaXMuZGF0YXNvdXJjZU1hcFt0YWJsZUtleV0gPSBkYXRhU291cmNlO1xuXG5cbiAgICAgIC8vIExvb3AgdGhlIGJhc2ljIHJlc29sdmVyc1xuICAgICAgdGFibGVEYXRhW3RhYmxlS2V5XS5yZXNvbHZlcnMuZm9yRWFjaCgocmVzb2x2ZXJLZXkpID0+IHtcbiAgICAgICAgY29uc3QgcmVzb2x2ZXIgPSByZXNvbHZlcnNbcmVzb2x2ZXJLZXldO1xuICAgICAgICBuZXcgUmVzb2x2ZXIoXG4gICAgICAgICAgdGhpcy5uZXN0ZWRBcHBzeW5jU3RhY2ssXG4gICAgICAgICAgYCR7cmVzb2x2ZXIudHlwZU5hbWV9LSR7cmVzb2x2ZXIuZmllbGROYW1lfS1yZXNvbHZlcmAsXG4gICAgICAgICAge1xuICAgICAgICAgICAgYXBpOiB0aGlzLmFwcHN5bmNBUEksXG4gICAgICAgICAgICB0eXBlTmFtZTogcmVzb2x2ZXIudHlwZU5hbWUsXG4gICAgICAgICAgICBmaWVsZE5hbWU6IHJlc29sdmVyLmZpZWxkTmFtZSxcbiAgICAgICAgICAgIGRhdGFTb3VyY2U6IGRhdGFTb3VyY2UsXG4gICAgICAgICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBNYXBwaW5nVGVtcGxhdGUuZnJvbUZpbGUoXG4gICAgICAgICAgICAgIHJlc29sdmVyLnJlcXVlc3RNYXBwaW5nVGVtcGxhdGUsXG4gICAgICAgICAgICApLFxuICAgICAgICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IE1hcHBpbmdUZW1wbGF0ZS5mcm9tRmlsZShcbiAgICAgICAgICAgICAgcmVzb2x2ZXIucmVzcG9uc2VNYXBwaW5nVGVtcGxhdGUsXG4gICAgICAgICAgICApLFxuICAgICAgICAgIH0sXG4gICAgICAgICk7XG4gICAgICB9KTtcblxuICAgICAgLy8gTG9vcCB0aGUgZ3NpIHJlc29sdmVyc1xuICAgICAgdGFibGVEYXRhW3RhYmxlS2V5XS5nc2lSZXNvbHZlcnMuZm9yRWFjaCgocmVzb2x2ZXJLZXkpID0+IHtcbiAgICAgICAgY29uc3QgcmVzb2x2ZXIgPSByZXNvbHZlcnMuZ3NpW3Jlc29sdmVyS2V5XTtcbiAgICAgICAgbmV3IFJlc29sdmVyKFxuICAgICAgICAgIHRoaXMubmVzdGVkQXBwc3luY1N0YWNrLFxuICAgICAgICAgIGAke3Jlc29sdmVyLnR5cGVOYW1lfS0ke3Jlc29sdmVyLmZpZWxkTmFtZX0tcmVzb2x2ZXJgLFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGFwaTogdGhpcy5hcHBzeW5jQVBJLFxuICAgICAgICAgICAgdHlwZU5hbWU6IHJlc29sdmVyLnR5cGVOYW1lLFxuICAgICAgICAgICAgZmllbGROYW1lOiByZXNvbHZlci5maWVsZE5hbWUsXG4gICAgICAgICAgICBkYXRhU291cmNlOiBkYXRhU291cmNlLFxuICAgICAgICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogTWFwcGluZ1RlbXBsYXRlLmZyb21GaWxlKFxuICAgICAgICAgICAgICByZXNvbHZlci5yZXF1ZXN0TWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBNYXBwaW5nVGVtcGxhdGUuZnJvbUZpbGUoXG4gICAgICAgICAgICAgIHJlc29sdmVyLnJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICB9LFxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdGFibGVOYW1lTWFwO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVUYWJsZSh0YWJsZURhdGE6IENka1RyYW5zZm9ybWVyVGFibGUsIHRhYmxlTmFtZT86IHN0cmluZykge1xuICAgIC8vIEkgZG8gbm90IHdhbnQgdG8gZm9yY2UgcGVvcGxlIHRvIHBhc3MgYFR5cGVUYWJsZWAgLSB0aGlzIHdheSB0aGV5IGFyZSBvbmx5IHBhc3NpbmcgdGhlIEBtb2RlbCBUeXBlIG5hbWVcbiAgICBjb25zdCBtb2RlbFR5cGVOYW1lID0gdGFibGVEYXRhLnRhYmxlTmFtZS5yZXBsYWNlKCdUYWJsZScsICcnKTtcbiAgICBjb25zdCBzdHJlYW1TcGVjaWZpY2F0aW9uID0gdGhpcy5wcm9wcy5keW5hbW9EYlN0cmVhbUNvbmZpZyAmJiB0aGlzLnByb3BzLmR5bmFtb0RiU3RyZWFtQ29uZmlnW21vZGVsVHlwZU5hbWVdO1xuICAgIGNvbnN0IHRhYmxlUHJvcHM6IFRhYmxlUHJvcHMgPSB7XG4gICAgICB0YWJsZU5hbWUsXG4gICAgICBiaWxsaW5nTW9kZTogQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgcGFydGl0aW9uS2V5OiB7XG4gICAgICAgIG5hbWU6IHRhYmxlRGF0YS5wYXJ0aXRpb25LZXkubmFtZSxcbiAgICAgICAgdHlwZTogdGhpcy5jb252ZXJ0QXR0cmlidXRlVHlwZSh0YWJsZURhdGEucGFydGl0aW9uS2V5LnR5cGUpLFxuICAgICAgfSxcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRoaXMucG9pbnRJblRpbWVSZWNvdmVyeSxcbiAgICAgIHNvcnRLZXk6IHRhYmxlRGF0YS5zb3J0S2V5ICYmIHRhYmxlRGF0YS5zb3J0S2V5Lm5hbWVcbiAgICAgICAgPyB7XG4gICAgICAgICAgbmFtZTogdGFibGVEYXRhLnNvcnRLZXkubmFtZSxcbiAgICAgICAgICB0eXBlOiB0aGlzLmNvbnZlcnRBdHRyaWJ1dGVUeXBlKHRhYmxlRGF0YS5zb3J0S2V5LnR5cGUpLFxuICAgICAgICB9IDogdW5kZWZpbmVkLFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogdGFibGVEYXRhPy50dGw/LmVuYWJsZWQgPyB0YWJsZURhdGEudHRsLmF0dHJpYnV0ZU5hbWUgOiB1bmRlZmluZWQsXG4gICAgICBzdHJlYW06IHN0cmVhbVNwZWNpZmljYXRpb24sXG4gICAgfTtcblxuICAgIGNvbnN0IHRhYmxlID0gbmV3IFRhYmxlKFxuICAgICAgdGhpcy5uZXN0ZWRBcHBzeW5jU3RhY2ssXG4gICAgICB0YWJsZURhdGEudGFibGVOYW1lLFxuICAgICAgdGFibGVQcm9wcyxcbiAgICApO1xuXG4gICAgdGFibGVEYXRhLmxvY2FsU2Vjb25kYXJ5SW5kZXhlcy5mb3JFYWNoKChsc2kpID0+IHtcbiAgICAgIHRhYmxlLmFkZExvY2FsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgICBpbmRleE5hbWU6IGxzaS5pbmRleE5hbWUsXG4gICAgICAgIHNvcnRLZXk6IHtcbiAgICAgICAgICBuYW1lOiBsc2kuc29ydEtleS5uYW1lLFxuICAgICAgICAgIHR5cGU6IHRoaXMuY29udmVydEF0dHJpYnV0ZVR5cGUobHNpLnNvcnRLZXkudHlwZSksXG4gICAgICAgIH0sXG4gICAgICAgIHByb2plY3Rpb25UeXBlOiB0aGlzLmNvbnZlcnRQcm9qZWN0aW9uVHlwZShcbiAgICAgICAgICBsc2kucHJvamVjdGlvbi5Qcm9qZWN0aW9uVHlwZSxcbiAgICAgICAgKSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgdGFibGVEYXRhLmdsb2JhbFNlY29uZGFyeUluZGV4ZXMuZm9yRWFjaCgoZ3NpKSA9PiB7XG4gICAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICAgIGluZGV4TmFtZTogZ3NpLmluZGV4TmFtZSxcbiAgICAgICAgcGFydGl0aW9uS2V5OiB7XG4gICAgICAgICAgbmFtZTogZ3NpLnBhcnRpdGlvbktleS5uYW1lLFxuICAgICAgICAgIHR5cGU6IHRoaXMuY29udmVydEF0dHJpYnV0ZVR5cGUoZ3NpLnBhcnRpdGlvbktleS50eXBlKSxcbiAgICAgICAgfSxcbiAgICAgICAgc29ydEtleTogZ3NpLnNvcnRLZXkgJiYgZ3NpLnNvcnRLZXkubmFtZVxuICAgICAgICAgID8ge1xuICAgICAgICAgICAgbmFtZTogZ3NpLnNvcnRLZXkubmFtZSxcbiAgICAgICAgICAgIHR5cGU6IHRoaXMuY29udmVydEF0dHJpYnV0ZVR5cGUoZ3NpLnNvcnRLZXkudHlwZSksXG4gICAgICAgICAgfSA6IHVuZGVmaW5lZCxcbiAgICAgICAgcHJvamVjdGlvblR5cGU6IHRoaXMuY29udmVydFByb2plY3Rpb25UeXBlKFxuICAgICAgICAgIGdzaS5wcm9qZWN0aW9uLlByb2plY3Rpb25UeXBlLFxuICAgICAgICApLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gdGFibGU7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyB0aGUgc3luYyB0YWJsZSBmb3IgQW1wbGlmeSBEYXRhU3RvcmVcbiAgICogaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL2FwcHN5bmMvbGF0ZXN0L2Rldmd1aWRlL2NvbmZsaWN0LWRldGVjdGlvbi1hbmQtc3luYy5odG1sXG4gICAqIEBwYXJhbSB0YWJsZURhdGEgVGhlIENka1RyYW5zZm9ybWVyIHRhYmxlIGluZm9ybWF0aW9uXG4gICAqL1xuICBwcml2YXRlIGNyZWF0ZVN5bmNUYWJsZSh0YWJsZURhdGE6IENka1RyYW5zZm9ybWVyVGFibGUpOiBUYWJsZSB7XG4gICAgcmV0dXJuIG5ldyBUYWJsZSh0aGlzLCAnYXBwc3luYy1hcGktc3luYy10YWJsZScsIHtcbiAgICAgIGJpbGxpbmdNb2RlOiBCaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogdGFibGVEYXRhLnBhcnRpdGlvbktleS5uYW1lLFxuICAgICAgICB0eXBlOiB0aGlzLmNvbnZlcnRBdHRyaWJ1dGVUeXBlKHRhYmxlRGF0YS5wYXJ0aXRpb25LZXkudHlwZSksXG4gICAgICB9LFxuICAgICAgc29ydEtleToge1xuICAgICAgICBuYW1lOiB0YWJsZURhdGEuc29ydEtleSEubmFtZSwgLy8gV2Uga25vdyBpdCBoYXMgYSBzb3J0a2V5IGJlY2F1c2Ugd2UgZm9yY2VkIGl0IHRvXG4gICAgICAgIHR5cGU6IHRoaXMuY29udmVydEF0dHJpYnV0ZVR5cGUodGFibGVEYXRhLnNvcnRLZXkhLnR5cGUpLCAvLyBXZSBrbm93IGl0IGhhcyBhIHNvcnRrZXkgYmVjYXVzZSB3ZSBmb3JjZWQgaXQgdG9cbiAgICAgIH0sXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiB0YWJsZURhdGEudHRsPy5hdHRyaWJ1dGVOYW1lIHx8ICdfdHRsJyxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgY29udmVydEF0dHJpYnV0ZVR5cGUodHlwZTogc3RyaW5nKTogQXR0cmlidXRlVHlwZSB7XG4gICAgc3dpdGNoICh0eXBlKSB7XG4gICAgICBjYXNlICdOJzpcbiAgICAgICAgcmV0dXJuIEF0dHJpYnV0ZVR5cGUuTlVNQkVSO1xuICAgICAgY2FzZSAnQic6XG4gICAgICAgIHJldHVybiBBdHRyaWJ1dGVUeXBlLkJJTkFSWTtcbiAgICAgIGNhc2UgJ1MnOiAvLyBTYW1lIGFzIGRlZmF1bHRcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiBBdHRyaWJ1dGVUeXBlLlNUUklORztcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGNvbnZlcnRQcm9qZWN0aW9uVHlwZSh0eXBlOiBzdHJpbmcpOiBQcm9qZWN0aW9uVHlwZSB7XG4gICAgc3dpdGNoICh0eXBlKSB7XG4gICAgICBjYXNlICdJTkNMVURFJzpcbiAgICAgICAgcmV0dXJuIFByb2plY3Rpb25UeXBlLklOQ0xVREU7XG4gICAgICBjYXNlICdLRVlTX09OTFknOlxuICAgICAgICByZXR1cm4gUHJvamVjdGlvblR5cGUuS0VZU19PTkxZO1xuICAgICAgY2FzZSAnQUxMJzogLy8gU2FtZSBhcyBkZWZhdWx0XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4gUHJvamVjdGlvblR5cGUuQUxMO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlSHR0cFJlc29sdmVycygpIHtcbiAgICBmb3IgKGNvbnN0IFtlbmRwb2ludCwgaHR0cFJlc29sdmVyc10gb2YgT2JqZWN0LmVudHJpZXMoXG4gICAgICB0aGlzLmh0dHBSZXNvbHZlcnMsXG4gICAgKSkge1xuICAgICAgY29uc3Qgc3RyaXBwZWRFbmRwb2ludCA9IGVuZHBvaW50LnJlcGxhY2UoL1teXzAtOUEtWmEtel0vZywgJycpO1xuICAgICAgY29uc3QgaHR0cERhdGFTb3VyY2UgPSB0aGlzLmFwcHN5bmNBUEkuYWRkSHR0cERhdGFTb3VyY2UoXG4gICAgICAgIGAke3N0cmlwcGVkRW5kcG9pbnR9YCxcbiAgICAgICAgZW5kcG9pbnQsXG4gICAgICApO1xuXG4gICAgICBodHRwUmVzb2x2ZXJzLmZvckVhY2goKHJlc29sdmVyOiBDZGtUcmFuc2Zvcm1lckh0dHBSZXNvbHZlcikgPT4ge1xuICAgICAgICBuZXcgUmVzb2x2ZXIoXG4gICAgICAgICAgdGhpcy5uZXN0ZWRBcHBzeW5jU3RhY2ssXG4gICAgICAgICAgYCR7cmVzb2x2ZXIudHlwZU5hbWV9LSR7cmVzb2x2ZXIuZmllbGROYW1lfS1yZXNvbHZlcmAsXG4gICAgICAgICAge1xuICAgICAgICAgICAgYXBpOiB0aGlzLmFwcHN5bmNBUEksXG4gICAgICAgICAgICB0eXBlTmFtZTogcmVzb2x2ZXIudHlwZU5hbWUsXG4gICAgICAgICAgICBmaWVsZE5hbWU6IHJlc29sdmVyLmZpZWxkTmFtZSxcbiAgICAgICAgICAgIGRhdGFTb3VyY2U6IGh0dHBEYXRhU291cmNlLFxuICAgICAgICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoXG4gICAgICAgICAgICAgIHJlc29sdmVyLmRlZmF1bHRSZXF1ZXN0TWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBNYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhcbiAgICAgICAgICAgICAgcmVzb2x2ZXIuZGVmYXVsdFJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICB9LFxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRoaXMgdGFrZXMgb25lIG9mIHRoZSBhdXRvZ2VuZXJhdGVkIHBvbGljaWVzIGZyb20gQVdTIGFuZCBidWlsZHMgdGhlIGxpc3Qgb2YgQVJOcyBmb3IgZ3JhbnRpbmcgR3JhcGhRTCBhY2Nlc3MgbGF0ZXJcbiAgICogQHBhcmFtIHBvbGljeSBUaGUgYXV0byBnZW5lcmF0ZWQgcG9saWN5IGZyb20gdGhlIEFwcFN5bmMgVHJhbnNmb3JtZXJzXG4gICAqIEByZXR1cm5zIEFuIGFycmF5IG9mIHJlc291cmNlIGFybnMgZm9yIHVzZSB3aXRoIGdyYW50c1xuICAgKi9cbiAgcHJpdmF0ZSBnZXRSZXNvdXJjZXNGcm9tR2VuZXJhdGVkUm9sZVBvbGljeShwb2xpY3k/OiBSZXNvdXJjZSk6IHN0cmluZ1tdIHtcbiAgICBpZiAoIXBvbGljeT8uUHJvcGVydGllcz8uUG9saWN5RG9jdW1lbnQ/LlN0YXRlbWVudCkgcmV0dXJuIFtdO1xuXG4gICAgY29uc3QgeyByZWdpb24sIGFjY291bnQgfSA9IHRoaXMubmVzdGVkQXBwc3luY1N0YWNrO1xuXG4gICAgY29uc3QgcmVzb2x2ZWRSZXNvdXJjZXM6IHN0cmluZ1tdID0gW107XG4gICAgZm9yIChjb25zdCBzdGF0ZW1lbnQgb2YgcG9saWN5LlByb3BlcnRpZXMuUG9saWN5RG9jdW1lbnQuU3RhdGVtZW50KSB7XG4gICAgICBjb25zdCB7IFJlc291cmNlOiByZXNvdXJjZXMgPSBbXSB9ID0gc3RhdGVtZW50ID8/IHt9O1xuICAgICAgZm9yIChjb25zdCByZXNvdXJjZSBvZiByZXNvdXJjZXMpIHtcbiAgICAgICAgY29uc3Qgc3VicyA9IHJlc291cmNlWydGbjo6U3ViJ11bMV07XG4gICAgICAgIGNvbnN0IHsgdHlwZU5hbWUsIGZpZWxkTmFtZSB9ID0gc3VicyA/PyB7fTtcbiAgICAgICAgaWYgKGZpZWxkTmFtZSkge1xuICAgICAgICAgIHJlc29sdmVkUmVzb3VyY2VzLnB1c2goYGFybjphd3M6YXBwc3luYzoke3JlZ2lvbn06JHthY2NvdW50fTphcGlzLyR7dGhpcy5hcHBzeW5jQVBJLmFwaUlkfS90eXBlcy8ke3R5cGVOYW1lfS9maWVsZHMvJHtmaWVsZE5hbWV9YCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzb2x2ZWRSZXNvdXJjZXMucHVzaChgYXJuOmF3czphcHBzeW5jOiR7cmVnaW9ufToke2FjY291bnR9OmFwaXMvJHt0aGlzLmFwcHN5bmNBUEkuYXBpSWR9L3R5cGVzLyR7dHlwZU5hbWV9LypgKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXNvbHZlZFJlc291cmNlcztcbiAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIGFkZExhbWJkYURhdGFTb3VyY2VBbmRSZXNvbHZlcnMoXG4gICAgZnVuY3Rpb25OYW1lOiBzdHJpbmcsXG4gICAgaWQ6IHN0cmluZyxcbiAgICBsYW1iZGFGdW5jdGlvbjogSUZ1bmN0aW9uLFxuICAgIG9wdGlvbnM/OiBEYXRhU291cmNlT3B0aW9ucyxcbiAgKTogTGFtYmRhRGF0YVNvdXJjZSB7XG4gICAgY29uc3QgZnVuY3Rpb25EYXRhU291cmNlID0gdGhpcy5hcHBzeW5jQVBJLmFkZExhbWJkYURhdGFTb3VyY2UoXG4gICAgICBpZCxcbiAgICAgIGxhbWJkYUZ1bmN0aW9uLFxuICAgICAgb3B0aW9ucyxcbiAgICApO1xuXG4gICAgZm9yIChjb25zdCByZXNvbHZlciBvZiB0aGlzLmZ1bmN0aW9uUmVzb2x2ZXJzW2Z1bmN0aW9uTmFtZV0pIHtcbiAgICAgIG5ldyBSZXNvbHZlcihcbiAgICAgICAgdGhpcy5uZXN0ZWRBcHBzeW5jU3RhY2ssXG4gICAgICAgIGAke3Jlc29sdmVyLnR5cGVOYW1lfS0ke3Jlc29sdmVyLmZpZWxkTmFtZX0tcmVzb2x2ZXJgLFxuICAgICAgICB7XG4gICAgICAgICAgYXBpOiB0aGlzLmFwcHN5bmNBUEksXG4gICAgICAgICAgdHlwZU5hbWU6IHJlc29sdmVyLnR5cGVOYW1lLFxuICAgICAgICAgIGZpZWxkTmFtZTogcmVzb2x2ZXIuZmllbGROYW1lLFxuICAgICAgICAgIGRhdGFTb3VyY2U6IGZ1bmN0aW9uRGF0YVNvdXJjZSxcbiAgICAgICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBNYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhcbiAgICAgICAgICAgIHJlc29sdmVyLmRlZmF1bHRSZXF1ZXN0TWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICksXG4gICAgICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IE1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKFxuICAgICAgICAgICAgcmVzb2x2ZXIuZGVmYXVsdFJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICksIC8vIFRoaXMgZGVmYXVsdHMgdG8gYWxsb3cgZXJyb3JzIHRvIHJldHVybiB0byB0aGUgY2xpZW50IGluc3RlYWQgb2YgdGhyb3dpbmdcbiAgICAgICAgfSxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZ1bmN0aW9uRGF0YVNvdXJjZTtcbiAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyBhZGREeW5hbW9EQlN0cmVhbShwcm9wczogRHluYW1vREJTdHJlYW1Qcm9wcyk6IHN0cmluZyB7XG4gICAgY29uc3QgdGFibGVOYW1lID0gYCR7cHJvcHMubW9kZWxUeXBlTmFtZX1UYWJsZWA7XG4gICAgY29uc3QgdGFibGUgPSB0aGlzLnRhYmxlTWFwW3RhYmxlTmFtZV07XG4gICAgaWYgKCF0YWJsZSkgdGhyb3cgbmV3IEVycm9yKGBUYWJsZSB3aXRoIG5hbWUgJyR7dGFibGVOYW1lfScgbm90IGZvdW5kLmApO1xuXG4gICAgY29uc3QgY2ZuVGFibGUgPSB0YWJsZS5ub2RlLmRlZmF1bHRDaGlsZCBhcyBDZm5UYWJsZTtcbiAgICBjZm5UYWJsZS5zdHJlYW1TcGVjaWZpY2F0aW9uID0ge1xuICAgICAgc3RyZWFtVmlld1R5cGU6IHByb3BzLnN0cmVhbVZpZXdUeXBlLFxuICAgIH07XG5cbiAgICByZXR1cm4gY2ZuVGFibGUuYXR0clN0cmVhbUFybjtcbiAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyBvdmVycmlkZVJlc29sdmVyKHByb3BzOiBPdmVycmlkZVJlc29sdmVyUHJvcHMpIHtcbiAgICBjb25zdCByZXNvbHZlciA9IHRoaXMubmVzdGVkQXBwc3luY1N0YWNrLm5vZGUudHJ5RmluZENoaWxkKGAke3Byb3BzLnR5cGVOYW1lfS0ke3Byb3BzLmZpZWxkTmFtZX0tcmVzb2x2ZXJgKSBhcyBSZXNvbHZlcjtcbiAgICBpZiAoIXJlc29sdmVyKSB0aHJvdyBuZXcgRXJyb3IoYFJlc29sdmVyIHdpdGggdHlwZU5hbWUgJyR7cHJvcHMudHlwZU5hbWV9JyBhbmQgZmllbGROYW1lICcke3Byb3BzLmZpZWxkTmFtZX0nIG5vdCBmb3VuZGApO1xuXG4gICAgY29uc3QgY2ZuUmVzb2x2ZXIgPSByZXNvbHZlci5ub2RlLmRlZmF1bHRDaGlsZCBhcyBDZm5SZXNvbHZlcjtcbiAgICBpZiAoIWNmblJlc29sdmVyKSB0aHJvdyBuZXcgRXJyb3IoYFJlc29sdmVyIHdpdGggdHlwZU5hbWUgJyR7cHJvcHMudHlwZU5hbWV9JyBhbmQgZmllbGROYW1lICcke3Byb3BzLmZpZWxkTmFtZX0nIG5vdCBmb3VuZGApO1xuXG4gICAgaWYgKHByb3BzLnJlcXVlc3RNYXBwaW5nVGVtcGxhdGVGaWxlKSB7XG4gICAgICBjZm5SZXNvbHZlci5yZXF1ZXN0TWFwcGluZ1RlbXBsYXRlID0gZnMucmVhZEZpbGVTeW5jKHByb3BzLnJlcXVlc3RNYXBwaW5nVGVtcGxhdGVGaWxlKS50b1N0cmluZygndXRmLTgnKTtcbiAgICB9XG5cbiAgICBpZiAocHJvcHMucmVzcG9uc2VNYXBwaW5nVGVtcGxhdGVGaWxlKSB7XG4gICAgICBjZm5SZXNvbHZlci5yZXNwb25zZU1hcHBpbmdUZW1wbGF0ZSA9IGZzLnJlYWRGaWxlU3luYyhwcm9wcy5yZXNwb25zZU1hcHBpbmdUZW1wbGF0ZUZpbGUpLnRvU3RyaW5nKCd1dGYtOCcpO1xuICAgIH1cbiAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIGdyYW50UHVibGljKGdyYW50ZWU6IElHcmFudGFibGUpOiBHcmFudCB7XG4gICAgcmV0dXJuIEdyYW50LmFkZFRvUHJpbmNpcGFsKHtcbiAgICAgIGdyYW50ZWUsXG4gICAgICBhY3Rpb25zOiBbJ2FwcHN5bmM6R3JhcGhRTCddLFxuICAgICAgcmVzb3VyY2VBcm5zOiB0aGlzLnB1YmxpY1Jlc291cmNlQXJucyxcbiAgICAgIHNjb3BlOiB0aGlzLFxuICAgIH0pO1xuICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIGdyYW50UHJpdmF0ZShncmFudGVlOiBJR3JhbnRhYmxlKTogR3JhbnQge1xuICAgIHJldHVybiBHcmFudC5hZGRUb1ByaW5jaXBhbCh7XG4gICAgICBncmFudGVlLFxuICAgICAgYWN0aW9uczogWydhcHBzeW5jOkdyYXBoUUwnXSxcbiAgICAgIHJlc291cmNlQXJuczogdGhpcy5wcml2YXRlUmVzb3VyY2VBcm5zLFxuICAgIH0pO1xuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRHluYW1vREJTdHJlYW1Qcm9wcyB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSBtb2RlbFR5cGVOYW1lOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHN0cmVhbVZpZXdUeXBlOiBTdHJlYW1WaWV3VHlwZTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBPdmVycmlkZVJlc29sdmVyUHJvcHMge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSB0eXBlTmFtZTogc3RyaW5nO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSBmaWVsZE5hbWU6IHN0cmluZztcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlRmlsZT86IHN0cmluZztcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcmVhZG9ubHkgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGVGaWxlPzogc3RyaW5nO1xufSJdfQ==