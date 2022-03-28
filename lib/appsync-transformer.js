"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppSyncTransformer = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const fs = require("fs");
const path = require("path");
const aws_appsync_alpha_1 = require("@aws-cdk/aws-appsync-alpha");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_dynamodb_1 = require("aws-cdk-lib/aws-dynamodb");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const constructs_1 = require("constructs");
const schema_transformer_1 = require("./transformer/schema-transformer");
const defaultAuthorizationConfig = {
    defaultAuthorization: {
        authorizationType: aws_appsync_alpha_1.AuthorizationType.API_KEY,
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
class AppSyncTransformer extends constructs_1.Construct {
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
            outputPath: props.outputPath,
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
        this.nestedAppsyncStack = new aws_cdk_lib_1.NestedStack(this, (_h = props.nestedStackName) !== null && _h !== void 0 ? _h : 'appsync-nested-stack');
        // AppSync
        this.appsyncAPI = new aws_appsync_alpha_1.GraphqlApi(this.nestedAppsyncStack, `${id}-api`, {
            name: props.apiName ? props.apiName : `${id}-api`,
            authorizationConfig: props.authorizationConfig
                ? props.authorizationConfig
                : defaultAuthorizationConfig,
            logConfig: {
                fieldLogLevel: props.fieldLogLevel
                    ? props.fieldLogLevel
                    : aws_appsync_alpha_1.FieldLogLevel.NONE,
            },
            schema: aws_appsync_alpha_1.Schema.fromAsset(path.join(transformer.outputPath, 'schema.graphql')),
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
        new aws_cdk_lib_1.CfnOutput(scope, 'appsyncGraphQLEndpointOutput', {
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
            new aws_appsync_alpha_1.Resolver(this.nestedAppsyncStack, `${resolver.typeName}-${resolver.fieldName}-resolver`, {
                api: this.appsyncAPI,
                typeName: resolver.typeName,
                fieldName: resolver.fieldName,
                dataSource: noneDataSource,
                requestMappingTemplate: aws_appsync_alpha_1.MappingTemplate.fromFile(resolver.requestMappingTemplate),
                responseMappingTemplate: aws_appsync_alpha_1.MappingTemplate.fromFile(resolver.responseMappingTemplate),
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
                dataSource.grantPrincipal.addToPrincipalPolicy(new aws_iam_1.PolicyStatement({
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
                new aws_appsync_alpha_1.Resolver(this.nestedAppsyncStack, `${resolver.typeName}-${resolver.fieldName}-resolver`, {
                    api: this.appsyncAPI,
                    typeName: resolver.typeName,
                    fieldName: resolver.fieldName,
                    dataSource: dataSource,
                    requestMappingTemplate: aws_appsync_alpha_1.MappingTemplate.fromFile(resolver.requestMappingTemplate),
                    responseMappingTemplate: aws_appsync_alpha_1.MappingTemplate.fromFile(resolver.responseMappingTemplate),
                });
            });
            // Loop the gsi resolvers
            tableData[tableKey].gsiResolvers.forEach((resolverKey) => {
                const resolver = resolvers.gsi[resolverKey];
                new aws_appsync_alpha_1.Resolver(this.nestedAppsyncStack, `${resolver.typeName}-${resolver.fieldName}-resolver`, {
                    api: this.appsyncAPI,
                    typeName: resolver.typeName,
                    fieldName: resolver.fieldName,
                    dataSource: dataSource,
                    requestMappingTemplate: aws_appsync_alpha_1.MappingTemplate.fromFile(resolver.requestMappingTemplate),
                    responseMappingTemplate: aws_appsync_alpha_1.MappingTemplate.fromFile(resolver.responseMappingTemplate),
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
                new aws_appsync_alpha_1.Resolver(this.nestedAppsyncStack, `${resolver.typeName}-${resolver.fieldName}-resolver`, {
                    api: this.appsyncAPI,
                    typeName: resolver.typeName,
                    fieldName: resolver.fieldName,
                    dataSource: httpDataSource,
                    requestMappingTemplate: aws_appsync_alpha_1.MappingTemplate.fromString(resolver.defaultRequestMappingTemplate),
                    responseMappingTemplate: aws_appsync_alpha_1.MappingTemplate.fromString(resolver.defaultResponseMappingTemplate),
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
            new aws_appsync_alpha_1.Resolver(this.nestedAppsyncStack, `${resolver.typeName}-${resolver.fieldName}-resolver`, {
                api: this.appsyncAPI,
                typeName: resolver.typeName,
                fieldName: resolver.fieldName,
                dataSource: functionDataSource,
                requestMappingTemplate: aws_appsync_alpha_1.MappingTemplate.fromString(resolver.defaultRequestMappingTemplate),
                responseMappingTemplate: aws_appsync_alpha_1.MappingTemplate.fromString(resolver.defaultResponseMappingTemplate),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwc3luYy10cmFuc2Zvcm1lci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9hcHBzeW5jLXRyYW5zZm9ybWVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3QixrRUFXb0M7QUFFcEMsNkNBQXFEO0FBR3JELDJEQVFrQztBQUNsQyxpREFBaUY7QUFFakYsMkNBQXVDO0FBV3ZDLHlFQUcwQztBQWdEMUMsTUFBTSwwQkFBMEIsR0FBd0I7SUFDdEQsb0JBQW9CLEVBQUU7UUFDcEIsaUJBQWlCLEVBQUUscUNBQWlCLENBQUMsT0FBTztRQUM1QyxZQUFZLEVBQUU7WUFDWixXQUFXLEVBQUUsdUNBQXVDO1lBQ3BELElBQUksRUFBRSxLQUFLO1NBQ1o7S0FDRjtDQUNGLENBQUM7Ozs7OztBQUdGLE1BQWEsa0JBQW1CLFNBQVEsc0JBQVM7Ozs7SUFzQy9DLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBOEI7O1FBQ3RFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFakIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUM7UUFDbkIsSUFBSSxDQUFDLFFBQVEsR0FBRyxFQUFFLENBQUM7UUFDbkIsSUFBSSxDQUFDLGFBQWEsR0FBRyxFQUFFLENBQUM7UUFDeEIsSUFBSSxDQUFDLGFBQWEsR0FBRyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUM7UUFDbkUsSUFBSSxDQUFDLG1CQUFtQixTQUFHLEtBQUssQ0FBQywrQkFBK0IsbUNBQUksS0FBSyxDQUFDO1FBRTFFLE1BQU0sd0JBQXdCLEdBQTJCO1lBQ3ZELFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVTtZQUM1QixVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVU7WUFDNUIsV0FBVyxRQUFFLEtBQUssQ0FBQyxXQUFXLG1DQUFJLEtB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QUFHLEVBQUUsQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLDBCQUEwQixDQUFDLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1NBQzFHO1FBRUQsSUFBSSxLQUFLLENBQUMsMkJBQTJCLEVBQUU7WUFDckMsV0FBVyxDQUFDLHVCQUF1QixHQUFHLEVBQUUsQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLDJCQUEyQixDQUFDLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1NBQzVHO0lBQ0gsQ0FBQzs7Ozs7Ozs7OztJQUdNLFdBQVcsQ0FBQyxPQUFtQjtRQUNwQyxPQUFPLGVBQUssQ0FBQyxjQUFjLENBQUM7WUFDMUIsT0FBTztZQUNQLE9BQU8sRUFBRSxDQUFDLGlCQUFpQixDQUFDO1lBQzVCLFlBQVksRUFBRSxJQUFJLENBQUMsa0JBQWtCO1lBQ3JDLEtBQUssRUFBRSxJQUFJO1NBQ1osQ0FBQyxDQUFDO0lBQ0wsQ0FBQzs7Ozs7Ozs7O0lBR00sWUFBWSxDQUFDLE9BQW1CO1FBQ3JDLE9BQU8sZUFBSyxDQUFDLGNBQWMsQ0FBQztZQUMxQixPQUFPO1lBQ1AsT0FBTyxFQUFFLENBQUMsaUJBQWlCLENBQUM7WUFDNUIsWUFBWSxFQUFFLElBQUksQ0FBQyxtQkFBbUI7U0FDdkMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQzs7QUE5aEJILGdEQStoQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHtcbiAgR3JhcGhxbEFwaSxcbiAgQXV0aG9yaXphdGlvblR5cGUsXG4gIEZpZWxkTG9nTGV2ZWwsXG4gIE1hcHBpbmdUZW1wbGF0ZSxcbiAgUmVzb2x2ZXIsXG4gIEF1dGhvcml6YXRpb25Db25maWcsXG4gIFNjaGVtYSxcbiAgRGF0YVNvdXJjZU9wdGlvbnMsXG4gIExhbWJkYURhdGFTb3VyY2UsXG4gIER5bmFtb0RiRGF0YVNvdXJjZSxcbn0gZnJvbSAnQGF3cy1jZGsvYXdzLWFwcHN5bmMtYWxwaGEnO1xuXG5pbXBvcnQgeyBOZXN0ZWRTdGFjaywgQ2ZuT3V0cHV0IH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ2ZuRGF0YVNvdXJjZSwgQ2ZuUmVzb2x2ZXIgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBwc3luYyc7XG5cbmltcG9ydCB7XG4gIENmblRhYmxlLFxuICBUYWJsZSxcbiAgQXR0cmlidXRlVHlwZSxcbiAgUHJvamVjdGlvblR5cGUsXG4gIEJpbGxpbmdNb2RlLFxuICBTdHJlYW1WaWV3VHlwZSxcbiAgVGFibGVQcm9wcyxcbn0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCB7IEVmZmVjdCwgR3JhbnQsIElHcmFudGFibGUsIFBvbGljeVN0YXRlbWVudCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0IHsgSUZ1bmN0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuaW1wb3J0IHtcbiAgQ2RrVHJhbnNmb3JtZXJSZXNvbHZlcixcbiAgQ2RrVHJhbnNmb3JtZXJGdW5jdGlvblJlc29sdmVyLFxuICBDZGtUcmFuc2Zvcm1lckh0dHBSZXNvbHZlcixcbiAgQ2RrVHJhbnNmb3JtZXJUYWJsZSxcbiAgU2NoZW1hVHJhbnNmb3JtZXJPdXRwdXRzLFxufSBmcm9tICcuL3RyYW5zZm9ybWVyJztcbmltcG9ydCB7IFJlc291cmNlIH0gZnJvbSAnLi90cmFuc2Zvcm1lci9yZXNvdXJjZSc7XG5cbmltcG9ydCB7XG4gIFNjaGVtYVRyYW5zZm9ybWVyLFxuICBTY2hlbWFUcmFuc2Zvcm1lclByb3BzLFxufSBmcm9tICcuL3RyYW5zZm9ybWVyL3NjaGVtYS10cmFuc2Zvcm1lcic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXBwU3luY1RyYW5zZm9ybWVyUHJvcHMge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSBzY2hlbWFQYXRoOiBzdHJpbmc7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSBvdXRwdXRQYXRoPzogc3RyaW5nO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IGF1dGhvcml6YXRpb25Db25maWc/OiBBdXRob3JpemF0aW9uQ29uZmlnO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcmVhZG9ubHkgYXBpTmFtZT86IHN0cmluZztcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSBzeW5jRW5hYmxlZD86IGJvb2xlYW47XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcmVhZG9ubHkgZW5hYmxlRHluYW1vUG9pbnRJblRpbWVSZWNvdmVyeT86IGJvb2xlYW47XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IGZpZWxkTG9nTGV2ZWw/OiBGaWVsZExvZ0xldmVsO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IHhyYXlFbmFibGVkPzogYm9vbGVhbjtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcmVhZG9ubHkgdGFibGVOYW1lcz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IGR5bmFtb0RiU3RyZWFtQ29uZmlnPzogeyBbbmFtZTogc3RyaW5nXTogU3RyZWFtVmlld1R5cGUgfTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSBuZXN0ZWRTdGFja05hbWU/OiBzdHJpbmc7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSBjdXN0b21WdGxUcmFuc2Zvcm1lclJvb3REaXJlY3Rvcnk/OiBzdHJpbmc7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcblxuICByZWFkb25seSBwcmVDZGtUcmFuc2Zvcm1lcnM/OiBhbnlbXTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG5cbiAgcmVhZG9ubHkgcG9zdENka1RyYW5zZm9ybWVycz86IGFueVtdO1xufVxuXG5jb25zdCBkZWZhdWx0QXV0aG9yaXphdGlvbkNvbmZpZzogQXV0aG9yaXphdGlvbkNvbmZpZyA9IHtcbiAgZGVmYXVsdEF1dGhvcml6YXRpb246IHtcbiAgICBhdXRob3JpemF0aW9uVHlwZTogQXV0aG9yaXphdGlvblR5cGUuQVBJX0tFWSxcbiAgICBhcGlLZXlDb25maWc6IHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQXV0byBnZW5lcmF0ZWQgQVBJIEtleSBmcm9tIGNvbnN0cnVjdCcsXG4gICAgICBuYW1lOiAnZGV2JyxcbiAgICB9LFxuICB9LFxufTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG5leHBvcnQgY2xhc3MgQXBwU3luY1RyYW5zZm9ybWVyIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICBwdWJsaWMgcmVhZG9ubHkgYXBwc3luY0FQSTogR3JhcGhxbEFwaTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIHJlYWRvbmx5IG5lc3RlZEFwcHN5bmNTdGFjazogTmVzdGVkU3RhY2s7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIHJlYWRvbmx5IHRhYmxlTmFtZU1hcDogeyBbbmFtZTogc3RyaW5nXTogc3RyaW5nIH07XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyByZWFkb25seSB0YWJsZU1hcDogeyBbbmFtZTogc3RyaW5nXTogVGFibGUgfTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIHJlYWRvbmx5IGRhdGFzb3VyY2VNYXA6IHsgW25hbWU6IHN0cmluZ106IER5bmFtb0RiRGF0YVNvdXJjZSB9O1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHB1YmxpYyByZWFkb25seSBvdXRwdXRzOiBTY2hlbWFUcmFuc2Zvcm1lck91dHB1dHM7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIHJlYWRvbmx5IHJlc29sdmVyczogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJSZXNvbHZlciB9O1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIHJlYWRvbmx5IGZ1bmN0aW9uUmVzb2x2ZXJzOiB7XG4gICAgW25hbWU6IHN0cmluZ106IENka1RyYW5zZm9ybWVyRnVuY3Rpb25SZXNvbHZlcltdO1xuICB9O1xuXG4gIHB1YmxpYyByZWFkb25seSBodHRwUmVzb2x2ZXJzOiB7XG4gICAgW25hbWU6IHN0cmluZ106IENka1RyYW5zZm9ybWVySHR0cFJlc29sdmVyW107XG4gIH07XG5cbiAgcHJpdmF0ZSBwcm9wczogQXBwU3luY1RyYW5zZm9ybWVyUHJvcHM7XG4gIHByaXZhdGUgaXNTeW5jRW5hYmxlZDogYm9vbGVhbjtcbiAgcHJpdmF0ZSBzeW5jVGFibGU6IFRhYmxlIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHBvaW50SW5UaW1lUmVjb3Zlcnk6IGJvb2xlYW47XG4gIHByaXZhdGUgcmVhZG9ubHkgcHVibGljUmVzb3VyY2VBcm5zOiBzdHJpbmdbXTtcbiAgcHJpdmF0ZSByZWFkb25seSBwcml2YXRlUmVzb3VyY2VBcm5zOiBzdHJpbmdbXTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQXBwU3luY1RyYW5zZm9ybWVyUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgdGhpcy5wcm9wcyA9IHByb3BzO1xuICAgIHRoaXMudGFibGVNYXAgPSB7fTtcbiAgICB0aGlzLmRhdGFzb3VyY2VNYXAgPSB7fTtcbiAgICB0aGlzLmlzU3luY0VuYWJsZWQgPSBwcm9wcy5zeW5jRW5hYmxlZCA/IHByb3BzLnN5bmNFbmFibGVkIDogZmFsc2U7XG4gICAgdGhpcy5wb2ludEluVGltZVJlY292ZXJ5ID0gcHJvcHMuZW5hYmxlRHluYW1vUG9pbnRJblRpbWVSZWNvdmVyeSA/PyBmYWxzZTtcblxuICAgIGNvbnN0IHRyYW5zZm9ybWVyQ29uZmlndXJhdGlvbjogU2NoZW1hVHJhbnNmb3JtZXJQcm9wcyA9IHtcbiAgICAgIHNjaGVtYVBhdGg6IHByb3BzLnNjaGVtYVBhdGgsXG4gICAgICBvdXRwdXRQYXRoOiBwcm9wcy5vdXRwdXRQYXRoLFxuICAgICAgc3luY0VuYWJsZWQ6IHByb3BzLnN5bmNFbmFibGVkID8/IGZhbHNlLFxuICAgICAgY3VzdG9tVnRsVHJhbnNmb3JtZXJSb290RGlyZWN0b3J5OiBwcm9wcy5jdXN0b21WdGxUcmFuc2Zvcm1lclJvb3REaXJlY3RvcnksXG4gICAgfTtcblxuICAgIC8vIENvbWJpbmUgdGhlIGFycmF5cyBzbyB3ZSBvbmx5IGxvb3Agb25jZVxuICAgIC8vIFRlc3QgZWFjaCB0cmFuc2Zvcm1lciB0byBzZWUgaWYgaXQgaW1wbGVtZW50cyBJVHJhbnNmb3JtZXJcbiAgICBjb25zdCBhbGxDdXN0b21UcmFuc2Zvcm1lcnMgPSBbLi4ucHJvcHMucHJlQ2RrVHJhbnNmb3JtZXJzID8/IFtdLCAuLi5wcm9wcy5wb3N0Q2RrVHJhbnNmb3JtZXJzID8/IFtdXTtcbiAgICBpZiAoYWxsQ3VzdG9tVHJhbnNmb3JtZXJzICYmIGFsbEN1c3RvbVRyYW5zZm9ybWVycy5sZW5ndGggPiAwKSB7XG4gICAgICBhbGxDdXN0b21UcmFuc2Zvcm1lcnMuZm9yRWFjaCh0cmFuc2Zvcm1lciA9PiB7XG4gICAgICAgIGlmICh0cmFuc2Zvcm1lciAmJiAhdGhpcy5pbXBsZW1lbnRzSVRyYW5zZm9ybWVyKHRyYW5zZm9ybWVyKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVHJhbnNmb3JtZXIgZG9lcyBub3QgaW1wbGVtZW50IElUcmFuc2Zvcm1lciBmcm9tIGdyYXBocWwtdHJhbnNmb3JtZXItY29yZTogJHt0cmFuc2Zvcm1lcn1gKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgdHJhbnNmb3JtZXIgPSBuZXcgU2NoZW1hVHJhbnNmb3JtZXIodHJhbnNmb3JtZXJDb25maWd1cmF0aW9uKTtcbiAgICB0aGlzLm91dHB1dHMgPSB0cmFuc2Zvcm1lci50cmFuc2Zvcm0ocHJvcHMucHJlQ2RrVHJhbnNmb3JtZXJzLCBwcm9wcy5wb3N0Q2RrVHJhbnNmb3JtZXJzKTtcbiAgICBjb25zdCByZXNvbHZlcnMgPSB0cmFuc2Zvcm1lci5nZXRSZXNvbHZlcnMoKTtcblxuICAgIHRoaXMuZnVuY3Rpb25SZXNvbHZlcnMgPSB0aGlzLm91dHB1dHMuZnVuY3Rpb25SZXNvbHZlcnMgPz8ge307XG5cbiAgICAvLyBSZW1vdmUgYW55IGZ1bmN0aW9uIHJlc29sdmVycyBmcm9tIHRoZSB0b3RhbCBsaXN0IG9mIHJlc29sdmVyc1xuICAgIC8vIE90aGVyd2lzZSBpdCB3aWxsIGFkZCB0aGVtIHR3aWNlXG4gICAgZm9yIChjb25zdCBbXywgZnVuY3Rpb25SZXNvbHZlcnNdIG9mIE9iamVjdC5lbnRyaWVzKFxuICAgICAgdGhpcy5mdW5jdGlvblJlc29sdmVycyxcbiAgICApKSB7XG4gICAgICBmdW5jdGlvblJlc29sdmVycy5mb3JFYWNoKChyZXNvbHZlcikgPT4ge1xuICAgICAgICBzd2l0Y2ggKHJlc29sdmVyLnR5cGVOYW1lKSB7XG4gICAgICAgICAgY2FzZSAnUXVlcnknOlxuICAgICAgICAgIGNhc2UgJ011dGF0aW9uJzpcbiAgICAgICAgICBjYXNlICdTdWJzY3JpcHRpb24nOlxuICAgICAgICAgICAgZGVsZXRlIHJlc29sdmVyc1tyZXNvbHZlci5maWVsZE5hbWVdO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHRoaXMuaHR0cFJlc29sdmVycyA9IHRoaXMub3V0cHV0cy5odHRwUmVzb2x2ZXJzID8/IHt9O1xuXG4gICAgLy8gUmVtb3ZlIGFueSBodHRwIHJlc29sdmVycyBmcm9tIHRoZSB0b3RhbCBsaXN0IG9mIHJlc29sdmVyc1xuICAgIC8vIE90aGVyd2lzZSBpdCB3aWxsIGFkZCB0aGVtIHR3aWNlXG4gICAgZm9yIChjb25zdCBbXywgaHR0cFJlc29sdmVyc10gb2YgT2JqZWN0LmVudHJpZXModGhpcy5odHRwUmVzb2x2ZXJzKSkge1xuICAgICAgaHR0cFJlc29sdmVycy5mb3JFYWNoKChyZXNvbHZlcikgPT4ge1xuICAgICAgICBzd2l0Y2ggKHJlc29sdmVyLnR5cGVOYW1lKSB7XG4gICAgICAgICAgY2FzZSAnUXVlcnknOlxuICAgICAgICAgIGNhc2UgJ011dGF0aW9uJzpcbiAgICAgICAgICBjYXNlICdTdWJzY3JpcHRpb24nOlxuICAgICAgICAgICAgZGVsZXRlIHJlc29sdmVyc1tyZXNvbHZlci5maWVsZE5hbWVdO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHRoaXMucmVzb2x2ZXJzID0gcmVzb2x2ZXJzO1xuXG4gICAgdGhpcy5uZXN0ZWRBcHBzeW5jU3RhY2sgPSBuZXcgTmVzdGVkU3RhY2sodGhpcywgcHJvcHMubmVzdGVkU3RhY2tOYW1lID8/ICdhcHBzeW5jLW5lc3RlZC1zdGFjaycpO1xuXG4gICAgLy8gQXBwU3luY1xuICAgIHRoaXMuYXBwc3luY0FQSSA9IG5ldyBHcmFwaHFsQXBpKHRoaXMubmVzdGVkQXBwc3luY1N0YWNrLCBgJHtpZH0tYXBpYCwge1xuICAgICAgbmFtZTogcHJvcHMuYXBpTmFtZSA/IHByb3BzLmFwaU5hbWUgOiBgJHtpZH0tYXBpYCxcbiAgICAgIGF1dGhvcml6YXRpb25Db25maWc6IHByb3BzLmF1dGhvcml6YXRpb25Db25maWdcbiAgICAgICAgPyBwcm9wcy5hdXRob3JpemF0aW9uQ29uZmlnXG4gICAgICAgIDogZGVmYXVsdEF1dGhvcml6YXRpb25Db25maWcsXG4gICAgICBsb2dDb25maWc6IHtcbiAgICAgICAgZmllbGRMb2dMZXZlbDogcHJvcHMuZmllbGRMb2dMZXZlbFxuICAgICAgICAgID8gcHJvcHMuZmllbGRMb2dMZXZlbFxuICAgICAgICAgIDogRmllbGRMb2dMZXZlbC5OT05FLFxuICAgICAgfSxcbiAgICAgIHNjaGVtYTogU2NoZW1hLmZyb21Bc3NldChwYXRoLmpvaW4odHJhbnNmb3JtZXIub3V0cHV0UGF0aCwgJ3NjaGVtYS5ncmFwaHFsJykpLFxuICAgICAgeHJheUVuYWJsZWQ6IHByb3BzLnhyYXlFbmFibGVkID8/IGZhbHNlLFxuICAgIH0pO1xuXG4gICAgbGV0IHRhYmxlRGF0YSA9IHRoaXMub3V0cHV0cy5jZGtUYWJsZXMgPz8ge307XG5cbiAgICAvLyBDaGVjayB0byBzZWUgaWYgc3luYyBpcyBlbmFibGVkXG4gICAgaWYgKHRhYmxlRGF0YS5EYXRhU3RvcmUpIHtcbiAgICAgIHRoaXMuaXNTeW5jRW5hYmxlZCA9IHRydWU7XG4gICAgICB0aGlzLnN5bmNUYWJsZSA9IHRoaXMuY3JlYXRlU3luY1RhYmxlKHRhYmxlRGF0YS5EYXRhU3RvcmUpO1xuICAgICAgZGVsZXRlIHRhYmxlRGF0YS5EYXRhU3RvcmU7IC8vIFdlIGRvbid0IHdhbnQgdG8gY3JlYXRlIHRoaXMgYWdhaW4gYmVsb3cgc28gcmVtb3ZlIGl0IGZyb20gdGhlIHRhYmxlRGF0YSBtYXBcbiAgICB9XG5cbiAgICB0aGlzLnRhYmxlTmFtZU1hcCA9IHRoaXMuY3JlYXRlVGFibGVzQW5kUmVzb2x2ZXJzKHRhYmxlRGF0YSwgcmVzb2x2ZXJzLCBwcm9wcy50YWJsZU5hbWVzKTtcbiAgICBpZiAodGhpcy5vdXRwdXRzLm5vbmVSZXNvbHZlcnMpIHtcbiAgICAgIHRoaXMuY3JlYXRlTm9uZURhdGFTb3VyY2VBbmRSZXNvbHZlcnMoXG4gICAgICAgIHRoaXMub3V0cHV0cy5ub25lUmVzb2x2ZXJzLFxuICAgICAgICByZXNvbHZlcnMsXG4gICAgICApO1xuICAgIH1cbiAgICB0aGlzLmNyZWF0ZUh0dHBSZXNvbHZlcnMoKTtcblxuICAgIHRoaXMucHVibGljUmVzb3VyY2VBcm5zID0gdGhpcy5nZXRSZXNvdXJjZXNGcm9tR2VuZXJhdGVkUm9sZVBvbGljeSh0cmFuc2Zvcm1lci51bmF1dGhSb2xlUG9saWN5KTtcbiAgICB0aGlzLnByaXZhdGVSZXNvdXJjZUFybnMgPSB0aGlzLmdldFJlc291cmNlc0Zyb21HZW5lcmF0ZWRSb2xlUG9saWN5KHRyYW5zZm9ybWVyLmF1dGhSb2xlUG9saWN5KTtcblxuICAgIC8vIE91dHB1dHMgc28gd2UgY2FuIGdlbmVyYXRlIGV4cG9ydHNcbiAgICBuZXcgQ2ZuT3V0cHV0KHNjb3BlLCAnYXBwc3luY0dyYXBoUUxFbmRwb2ludE91dHB1dCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmFwcHN5bmNBUEkuZ3JhcGhxbFVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnT3V0cHV0IGZvciBhd3NfYXBwc3luY19ncmFwaHFsRW5kcG9pbnQnLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIGdyYXBocWwtdHJhbnNmb3JtZXItY29yZSBuZWVkcyB0byBiZSBqc2lpIGVuYWJsZWQgdG8gcHVsbCB0aGUgSVRyYW5zZm9ybWVyIGludGVyZmFjZSBjb3JyZWN0bHkuXG4gICAqIFNpbmNlIGl0J3Mgbm90IGluIHBlZXIgZGVwZW5kZW5jaWVzIGl0IGRvZXNuJ3Qgc2hvdyB1cCBpbiB0aGUganNpaSBkZXBzIGxpc3QuXG4gICAqIFNpbmNlIGl0J3Mgbm90IGpzaWkgZW5hYmxlZCBpdCBoYXMgdG8gYmUgYnVuZGxlZC5cbiAgICogVGhlIHBhY2thZ2UgY2FuJ3QgYmUgaW4gQk9USCBwZWVyIGFuZCBidW5kbGVkIGRlcGVuZGVuY2llc1xuICAgKiBTbyB3ZSBkbyBhIGZha2UgdGVzdCB0byBtYWtlIHN1cmUgaXQgaW1wbGVtZW50cyB0aGVzZSBhbmQgaG9wZSBmb3IgdGhlIGJlc3RcbiAgICogQHBhcmFtIHRyYW5zZm9ybWVyXG4gICAqL1xuICBwcml2YXRlIGltcGxlbWVudHNJVHJhbnNmb3JtZXIodHJhbnNmb3JtZXI6IGFueSkge1xuICAgIHJldHVybiAnbmFtZScgaW4gdHJhbnNmb3JtZXJcbiAgICAgICYmICdkaXJlY3RpdmUnIGluIHRyYW5zZm9ybWVyXG4gICAgICAmJiAndHlwZURlZmluaXRpb25zJyBpbiB0cmFuc2Zvcm1lcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIE5PTkUgZGF0YSBzb3VyY2UgYW5kIGFzc29jaWF0ZWQgcmVzb2x2ZXJzXG4gICAqIEBwYXJhbSBub25lUmVzb2x2ZXJzIFRoZSByZXNvbHZlcnMgdGhhdCBiZWxvbmcgdG8gdGhlIG5vbmUgZGF0YSBzb3VyY2VcbiAgICogQHBhcmFtIHJlc29sdmVycyBUaGUgcmVzb2x2ZXIgbWFwIG1pbnVzIGZ1bmN0aW9uIHJlc29sdmVyc1xuICAgKi9cbiAgcHJpdmF0ZSBjcmVhdGVOb25lRGF0YVNvdXJjZUFuZFJlc29sdmVycyhcbiAgICBub25lUmVzb2x2ZXJzOiB7IFtuYW1lOiBzdHJpbmddOiBDZGtUcmFuc2Zvcm1lclJlc29sdmVyIH0sXG4gICAgcmVzb2x2ZXJzOiBhbnksXG4gICkge1xuICAgIGNvbnN0IG5vbmVEYXRhU291cmNlID0gdGhpcy5hcHBzeW5jQVBJLmFkZE5vbmVEYXRhU291cmNlKCdOT05FJyk7XG5cbiAgICBPYmplY3Qua2V5cyhub25lUmVzb2x2ZXJzKS5mb3JFYWNoKChyZXNvbHZlcktleSkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZXIgPSByZXNvbHZlcnNbcmVzb2x2ZXJLZXldO1xuICAgICAgbmV3IFJlc29sdmVyKFxuICAgICAgICB0aGlzLm5lc3RlZEFwcHN5bmNTdGFjayxcbiAgICAgICAgYCR7cmVzb2x2ZXIudHlwZU5hbWV9LSR7cmVzb2x2ZXIuZmllbGROYW1lfS1yZXNvbHZlcmAsXG4gICAgICAgIHtcbiAgICAgICAgICBhcGk6IHRoaXMuYXBwc3luY0FQSSxcbiAgICAgICAgICB0eXBlTmFtZTogcmVzb2x2ZXIudHlwZU5hbWUsXG4gICAgICAgICAgZmllbGROYW1lOiByZXNvbHZlci5maWVsZE5hbWUsXG4gICAgICAgICAgZGF0YVNvdXJjZTogbm9uZURhdGFTb3VyY2UsXG4gICAgICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogTWFwcGluZ1RlbXBsYXRlLmZyb21GaWxlKFxuICAgICAgICAgICAgcmVzb2x2ZXIucmVxdWVzdE1hcHBpbmdUZW1wbGF0ZSxcbiAgICAgICAgICApLFxuICAgICAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBNYXBwaW5nVGVtcGxhdGUuZnJvbUZpbGUoXG4gICAgICAgICAgICByZXNvbHZlci5yZXNwb25zZU1hcHBpbmdUZW1wbGF0ZSxcbiAgICAgICAgICApLFxuICAgICAgICB9LFxuICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGVhY2ggZHluYW1vZGIgdGFibGUsIGdzaXMsIGR5bmFtb2RiIGRhdGFzb3VyY2UsIGFuZCBhc3NvY2lhdGVkIHJlc29sdmVyc1xuICAgKiBJZiBzeW5jIGlzIGVuYWJsZWQgdGhlbiBUVEwgY29uZmlndXJhdGlvbiBpcyBhZGRlZFxuICAgKiBSZXR1cm5zIHRhYmxlTmFtZTogdGFibGUgbWFwIGluIGNhc2UgaXQgaXMgbmVlZGVkIGZvciBsYW1iZGEgZnVuY3Rpb25zLCBldGNcbiAgICogQHBhcmFtIHRhYmxlRGF0YSBUaGUgQ2RrVHJhbnNmb3JtZXIgdGFibGUgaW5mb3JtYXRpb25cbiAgICogQHBhcmFtIHJlc29sdmVycyBUaGUgcmVzb2x2ZXIgbWFwIG1pbnVzIGZ1bmN0aW9uIHJlc29sdmVyc1xuICAgKi9cbiAgcHJpdmF0ZSBjcmVhdGVUYWJsZXNBbmRSZXNvbHZlcnMoXG4gICAgdGFibGVEYXRhOiB7IFtuYW1lOiBzdHJpbmddOiBDZGtUcmFuc2Zvcm1lclRhYmxlIH0sXG4gICAgcmVzb2x2ZXJzOiBhbnksXG4gICAgdGFibGVOYW1lczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9LFxuICApOiB7IFtuYW1lOiBzdHJpbmddOiBzdHJpbmcgfSB7XG4gICAgY29uc3QgdGFibGVOYW1lTWFwOiBhbnkgPSB7fTtcblxuICAgIE9iamVjdC5rZXlzKHRhYmxlRGF0YSkuZm9yRWFjaCgodGFibGVLZXkpID0+IHtcbiAgICAgIGNvbnN0IHRhYmxlTmFtZSA9IHRhYmxlTmFtZXNbdGFibGVLZXldID8/IHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IHRhYmxlID0gdGhpcy5jcmVhdGVUYWJsZSh0YWJsZURhdGFbdGFibGVLZXldLCB0YWJsZU5hbWUpO1xuICAgICAgdGhpcy50YWJsZU1hcFt0YWJsZUtleV0gPSB0YWJsZTtcblxuICAgICAgY29uc3QgZGF0YVNvdXJjZSA9IHRoaXMuYXBwc3luY0FQSS5hZGREeW5hbW9EYkRhdGFTb3VyY2UodGFibGVLZXksIHRhYmxlKTtcblxuICAgICAgLy8gaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL0FXU0Nsb3VkRm9ybWF0aW9uL2xhdGVzdC9Vc2VyR3VpZGUvYXdzLXByb3BlcnRpZXMtYXBwc3luYy1kYXRhc291cmNlLWRlbHRhc3luY2NvbmZpZy5odG1sXG5cbiAgICAgIGlmICh0aGlzLmlzU3luY0VuYWJsZWQgJiYgdGhpcy5zeW5jVGFibGUpIHtcbiAgICAgICAgLy9AdHMtaWdub3JlIC0gZHMgaXMgdGhlIGJhc2UgQ2ZuRGF0YVNvdXJjZSBhbmQgdGhlIGRiIGNvbmZpZyBuZWVkcyB0byBiZSB2ZXJzaW9uZWQgLSBzZWUgQ2ZuRGF0YVNvdXJjZVxuICAgICAgICBkYXRhU291cmNlLmRzLmR5bmFtb0RiQ29uZmlnLnZlcnNpb25lZCA9IHRydWU7XG5cbiAgICAgICAgLy9AdHMtaWdub3JlIC0gZHMgaXMgdGhlIGJhc2UgQ2ZuRGF0YVNvdXJjZSAtIHNlZSBDZm5EYXRhU291cmNlXG4gICAgICAgIGRhdGFTb3VyY2UuZHMuZHluYW1vRGJDb25maWcuZGVsdGFTeW5jQ29uZmlnID0ge1xuICAgICAgICAgIGJhc2VUYWJsZVR0bDogJzQzMjAwJywgLy8gR290IHRoaXMgdmFsdWUgZnJvbSBhbXBsaWZ5IC0gMzAgZGF5cyBpbiBtaW51dGVzXG4gICAgICAgICAgZGVsdGFTeW5jVGFibGVOYW1lOiB0aGlzLnN5bmNUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgICAgZGVsdGFTeW5jVGFibGVUdGw6ICczMCcsIC8vIEdvdCB0aGlzIHZhbHVlIGZyb20gYW1wbGlmeSAtIDMwIG1pbnV0ZXNcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBOZWVkIHRvIGFkZCBwZXJtaXNzaW9uIGZvciBvdXIgZGF0YXNvdXJjZSBzZXJ2aWNlIHJvbGUgdG8gYWNjZXNzIHRoZSBzeW5jIHRhYmxlXG4gICAgICAgIGRhdGFTb3VyY2UuZ3JhbnRQcmluY2lwYWwuYWRkVG9QcmluY2lwYWxQb2xpY3koXG4gICAgICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICBlZmZlY3Q6IEVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgJ2R5bmFtb2RiOionLCAvLyBUT0RPOiBUaGlzIG1heSBiZSB0b28gcGVybWlzc2l2ZVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHJlc291cmNlczogW3RoaXMuc3luY1RhYmxlLnRhYmxlQXJuXSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZHluYW1vRGJDb25maWcgPSBkYXRhU291cmNlLmRzXG4gICAgICAgIC5keW5hbW9EYkNvbmZpZyBhcyBDZm5EYXRhU291cmNlLkR5bmFtb0RCQ29uZmlnUHJvcGVydHk7XG4gICAgICB0YWJsZU5hbWVNYXBbdGFibGVLZXldID0gZHluYW1vRGJDb25maWcudGFibGVOYW1lO1xuXG4gICAgICAvL0V4cG9zZSBkYXRhc291cmNlIHRvIHN1cHBvcnQgYWRkaW5nIG11bHRpcGxlIHJlc29sdmVyc1xuICAgICAgdGhpcy5kYXRhc291cmNlTWFwW3RhYmxlS2V5XSA9IGRhdGFTb3VyY2U7XG5cblxuICAgICAgLy8gTG9vcCB0aGUgYmFzaWMgcmVzb2x2ZXJzXG4gICAgICB0YWJsZURhdGFbdGFibGVLZXldLnJlc29sdmVycy5mb3JFYWNoKChyZXNvbHZlcktleSkgPT4ge1xuICAgICAgICBjb25zdCByZXNvbHZlciA9IHJlc29sdmVyc1tyZXNvbHZlcktleV07XG4gICAgICAgIG5ldyBSZXNvbHZlcihcbiAgICAgICAgICB0aGlzLm5lc3RlZEFwcHN5bmNTdGFjayxcbiAgICAgICAgICBgJHtyZXNvbHZlci50eXBlTmFtZX0tJHtyZXNvbHZlci5maWVsZE5hbWV9LXJlc29sdmVyYCxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBhcGk6IHRoaXMuYXBwc3luY0FQSSxcbiAgICAgICAgICAgIHR5cGVOYW1lOiByZXNvbHZlci50eXBlTmFtZSxcbiAgICAgICAgICAgIGZpZWxkTmFtZTogcmVzb2x2ZXIuZmllbGROYW1lLFxuICAgICAgICAgICAgZGF0YVNvdXJjZTogZGF0YVNvdXJjZSxcbiAgICAgICAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IE1hcHBpbmdUZW1wbGF0ZS5mcm9tRmlsZShcbiAgICAgICAgICAgICAgcmVzb2x2ZXIucmVxdWVzdE1hcHBpbmdUZW1wbGF0ZSxcbiAgICAgICAgICAgICksXG4gICAgICAgICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogTWFwcGluZ1RlbXBsYXRlLmZyb21GaWxlKFxuICAgICAgICAgICAgICByZXNvbHZlci5yZXNwb25zZU1hcHBpbmdUZW1wbGF0ZSxcbiAgICAgICAgICAgICksXG4gICAgICAgICAgfSxcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBMb29wIHRoZSBnc2kgcmVzb2x2ZXJzXG4gICAgICB0YWJsZURhdGFbdGFibGVLZXldLmdzaVJlc29sdmVycy5mb3JFYWNoKChyZXNvbHZlcktleSkgPT4ge1xuICAgICAgICBjb25zdCByZXNvbHZlciA9IHJlc29sdmVycy5nc2lbcmVzb2x2ZXJLZXldO1xuICAgICAgICBuZXcgUmVzb2x2ZXIoXG4gICAgICAgICAgdGhpcy5uZXN0ZWRBcHBzeW5jU3RhY2ssXG4gICAgICAgICAgYCR7cmVzb2x2ZXIudHlwZU5hbWV9LSR7cmVzb2x2ZXIuZmllbGROYW1lfS1yZXNvbHZlcmAsXG4gICAgICAgICAge1xuICAgICAgICAgICAgYXBpOiB0aGlzLmFwcHN5bmNBUEksXG4gICAgICAgICAgICB0eXBlTmFtZTogcmVzb2x2ZXIudHlwZU5hbWUsXG4gICAgICAgICAgICBmaWVsZE5hbWU6IHJlc29sdmVyLmZpZWxkTmFtZSxcbiAgICAgICAgICAgIGRhdGFTb3VyY2U6IGRhdGFTb3VyY2UsXG4gICAgICAgICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBNYXBwaW5nVGVtcGxhdGUuZnJvbUZpbGUoXG4gICAgICAgICAgICAgIHJlc29sdmVyLnJlcXVlc3RNYXBwaW5nVGVtcGxhdGUsXG4gICAgICAgICAgICApLFxuICAgICAgICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IE1hcHBpbmdUZW1wbGF0ZS5mcm9tRmlsZShcbiAgICAgICAgICAgICAgcmVzb2x2ZXIucmVzcG9uc2VNYXBwaW5nVGVtcGxhdGUsXG4gICAgICAgICAgICApLFxuICAgICAgICAgIH0sXG4gICAgICAgICk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiB0YWJsZU5hbWVNYXA7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZVRhYmxlKHRhYmxlRGF0YTogQ2RrVHJhbnNmb3JtZXJUYWJsZSwgdGFibGVOYW1lPzogc3RyaW5nKSB7XG4gICAgLy8gSSBkbyBub3Qgd2FudCB0byBmb3JjZSBwZW9wbGUgdG8gcGFzcyBgVHlwZVRhYmxlYCAtIHRoaXMgd2F5IHRoZXkgYXJlIG9ubHkgcGFzc2luZyB0aGUgQG1vZGVsIFR5cGUgbmFtZVxuICAgIGNvbnN0IG1vZGVsVHlwZU5hbWUgPSB0YWJsZURhdGEudGFibGVOYW1lLnJlcGxhY2UoJ1RhYmxlJywgJycpO1xuICAgIGNvbnN0IHN0cmVhbVNwZWNpZmljYXRpb24gPSB0aGlzLnByb3BzLmR5bmFtb0RiU3RyZWFtQ29uZmlnICYmIHRoaXMucHJvcHMuZHluYW1vRGJTdHJlYW1Db25maWdbbW9kZWxUeXBlTmFtZV07XG4gICAgY29uc3QgdGFibGVQcm9wczogVGFibGVQcm9wcyA9IHtcbiAgICAgIHRhYmxlTmFtZSxcbiAgICAgIGJpbGxpbmdNb2RlOiBCaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogdGFibGVEYXRhLnBhcnRpdGlvbktleS5uYW1lLFxuICAgICAgICB0eXBlOiB0aGlzLmNvbnZlcnRBdHRyaWJ1dGVUeXBlKHRhYmxlRGF0YS5wYXJ0aXRpb25LZXkudHlwZSksXG4gICAgICB9LFxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdGhpcy5wb2ludEluVGltZVJlY292ZXJ5LFxuICAgICAgc29ydEtleTogdGFibGVEYXRhLnNvcnRLZXkgJiYgdGFibGVEYXRhLnNvcnRLZXkubmFtZVxuICAgICAgICA/IHtcbiAgICAgICAgICBuYW1lOiB0YWJsZURhdGEuc29ydEtleS5uYW1lLFxuICAgICAgICAgIHR5cGU6IHRoaXMuY29udmVydEF0dHJpYnV0ZVR5cGUodGFibGVEYXRhLnNvcnRLZXkudHlwZSksXG4gICAgICAgIH0gOiB1bmRlZmluZWQsXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiB0YWJsZURhdGE/LnR0bD8uZW5hYmxlZCA/IHRhYmxlRGF0YS50dGwuYXR0cmlidXRlTmFtZSA6IHVuZGVmaW5lZCxcbiAgICAgIHN0cmVhbTogc3RyZWFtU3BlY2lmaWNhdGlvbixcbiAgICB9O1xuXG4gICAgY29uc3QgdGFibGUgPSBuZXcgVGFibGUoXG4gICAgICB0aGlzLm5lc3RlZEFwcHN5bmNTdGFjayxcbiAgICAgIHRhYmxlRGF0YS50YWJsZU5hbWUsXG4gICAgICB0YWJsZVByb3BzLFxuICAgICk7XG5cbiAgICB0YWJsZURhdGEubG9jYWxTZWNvbmRhcnlJbmRleGVzLmZvckVhY2goKGxzaSkgPT4ge1xuICAgICAgdGFibGUuYWRkTG9jYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICAgIGluZGV4TmFtZTogbHNpLmluZGV4TmFtZSxcbiAgICAgICAgc29ydEtleToge1xuICAgICAgICAgIG5hbWU6IGxzaS5zb3J0S2V5Lm5hbWUsXG4gICAgICAgICAgdHlwZTogdGhpcy5jb252ZXJ0QXR0cmlidXRlVHlwZShsc2kuc29ydEtleS50eXBlKSxcbiAgICAgICAgfSxcbiAgICAgICAgcHJvamVjdGlvblR5cGU6IHRoaXMuY29udmVydFByb2plY3Rpb25UeXBlKFxuICAgICAgICAgIGxzaS5wcm9qZWN0aW9uLlByb2plY3Rpb25UeXBlLFxuICAgICAgICApLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICB0YWJsZURhdGEuZ2xvYmFsU2Vjb25kYXJ5SW5kZXhlcy5mb3JFYWNoKChnc2kpID0+IHtcbiAgICAgIHRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgICAgaW5kZXhOYW1lOiBnc2kuaW5kZXhOYW1lLFxuICAgICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgICBuYW1lOiBnc2kucGFydGl0aW9uS2V5Lm5hbWUsXG4gICAgICAgICAgdHlwZTogdGhpcy5jb252ZXJ0QXR0cmlidXRlVHlwZShnc2kucGFydGl0aW9uS2V5LnR5cGUpLFxuICAgICAgICB9LFxuICAgICAgICBzb3J0S2V5OiBnc2kuc29ydEtleSAmJiBnc2kuc29ydEtleS5uYW1lXG4gICAgICAgICAgPyB7XG4gICAgICAgICAgICBuYW1lOiBnc2kuc29ydEtleS5uYW1lLFxuICAgICAgICAgICAgdHlwZTogdGhpcy5jb252ZXJ0QXR0cmlidXRlVHlwZShnc2kuc29ydEtleS50eXBlKSxcbiAgICAgICAgICB9IDogdW5kZWZpbmVkLFxuICAgICAgICBwcm9qZWN0aW9uVHlwZTogdGhpcy5jb252ZXJ0UHJvamVjdGlvblR5cGUoXG4gICAgICAgICAgZ3NpLnByb2plY3Rpb24uUHJvamVjdGlvblR5cGUsXG4gICAgICAgICksXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiB0YWJsZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSBzeW5jIHRhYmxlIGZvciBBbXBsaWZ5IERhdGFTdG9yZVxuICAgKiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vYXBwc3luYy9sYXRlc3QvZGV2Z3VpZGUvY29uZmxpY3QtZGV0ZWN0aW9uLWFuZC1zeW5jLmh0bWxcbiAgICogQHBhcmFtIHRhYmxlRGF0YSBUaGUgQ2RrVHJhbnNmb3JtZXIgdGFibGUgaW5mb3JtYXRpb25cbiAgICovXG4gIHByaXZhdGUgY3JlYXRlU3luY1RhYmxlKHRhYmxlRGF0YTogQ2RrVHJhbnNmb3JtZXJUYWJsZSk6IFRhYmxlIHtcbiAgICByZXR1cm4gbmV3IFRhYmxlKHRoaXMsICdhcHBzeW5jLWFwaS1zeW5jLXRhYmxlJywge1xuICAgICAgYmlsbGluZ01vZGU6IEJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICBuYW1lOiB0YWJsZURhdGEucGFydGl0aW9uS2V5Lm5hbWUsXG4gICAgICAgIHR5cGU6IHRoaXMuY29udmVydEF0dHJpYnV0ZVR5cGUodGFibGVEYXRhLnBhcnRpdGlvbktleS50eXBlKSxcbiAgICAgIH0sXG4gICAgICBzb3J0S2V5OiB7XG4gICAgICAgIG5hbWU6IHRhYmxlRGF0YS5zb3J0S2V5IS5uYW1lLCAvLyBXZSBrbm93IGl0IGhhcyBhIHNvcnRrZXkgYmVjYXVzZSB3ZSBmb3JjZWQgaXQgdG9cbiAgICAgICAgdHlwZTogdGhpcy5jb252ZXJ0QXR0cmlidXRlVHlwZSh0YWJsZURhdGEuc29ydEtleSEudHlwZSksIC8vIFdlIGtub3cgaXQgaGFzIGEgc29ydGtleSBiZWNhdXNlIHdlIGZvcmNlZCBpdCB0b1xuICAgICAgfSxcbiAgICAgIHRpbWVUb0xpdmVBdHRyaWJ1dGU6IHRhYmxlRGF0YS50dGw/LmF0dHJpYnV0ZU5hbWUgfHwgJ190dGwnLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBjb252ZXJ0QXR0cmlidXRlVHlwZSh0eXBlOiBzdHJpbmcpOiBBdHRyaWJ1dGVUeXBlIHtcbiAgICBzd2l0Y2ggKHR5cGUpIHtcbiAgICAgIGNhc2UgJ04nOlxuICAgICAgICByZXR1cm4gQXR0cmlidXRlVHlwZS5OVU1CRVI7XG4gICAgICBjYXNlICdCJzpcbiAgICAgICAgcmV0dXJuIEF0dHJpYnV0ZVR5cGUuQklOQVJZO1xuICAgICAgY2FzZSAnUyc6IC8vIFNhbWUgYXMgZGVmYXVsdFxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcmV0dXJuIEF0dHJpYnV0ZVR5cGUuU1RSSU5HO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgY29udmVydFByb2plY3Rpb25UeXBlKHR5cGU6IHN0cmluZyk6IFByb2plY3Rpb25UeXBlIHtcbiAgICBzd2l0Y2ggKHR5cGUpIHtcbiAgICAgIGNhc2UgJ0lOQ0xVREUnOlxuICAgICAgICByZXR1cm4gUHJvamVjdGlvblR5cGUuSU5DTFVERTtcbiAgICAgIGNhc2UgJ0tFWVNfT05MWSc6XG4gICAgICAgIHJldHVybiBQcm9qZWN0aW9uVHlwZS5LRVlTX09OTFk7XG4gICAgICBjYXNlICdBTEwnOiAvLyBTYW1lIGFzIGRlZmF1bHRcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiBQcm9qZWN0aW9uVHlwZS5BTEw7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVIdHRwUmVzb2x2ZXJzKCkge1xuICAgIGZvciAoY29uc3QgW2VuZHBvaW50LCBodHRwUmVzb2x2ZXJzXSBvZiBPYmplY3QuZW50cmllcyhcbiAgICAgIHRoaXMuaHR0cFJlc29sdmVycyxcbiAgICApKSB7XG4gICAgICBjb25zdCBzdHJpcHBlZEVuZHBvaW50ID0gZW5kcG9pbnQucmVwbGFjZSgvW15fMC05QS1aYS16XS9nLCAnJyk7XG4gICAgICBjb25zdCBodHRwRGF0YVNvdXJjZSA9IHRoaXMuYXBwc3luY0FQSS5hZGRIdHRwRGF0YVNvdXJjZShcbiAgICAgICAgYCR7c3RyaXBwZWRFbmRwb2ludH1gLFxuICAgICAgICBlbmRwb2ludCxcbiAgICAgICk7XG5cbiAgICAgIGh0dHBSZXNvbHZlcnMuZm9yRWFjaCgocmVzb2x2ZXI6IENka1RyYW5zZm9ybWVySHR0cFJlc29sdmVyKSA9PiB7XG4gICAgICAgIG5ldyBSZXNvbHZlcihcbiAgICAgICAgICB0aGlzLm5lc3RlZEFwcHN5bmNTdGFjayxcbiAgICAgICAgICBgJHtyZXNvbHZlci50eXBlTmFtZX0tJHtyZXNvbHZlci5maWVsZE5hbWV9LXJlc29sdmVyYCxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBhcGk6IHRoaXMuYXBwc3luY0FQSSxcbiAgICAgICAgICAgIHR5cGVOYW1lOiByZXNvbHZlci50eXBlTmFtZSxcbiAgICAgICAgICAgIGZpZWxkTmFtZTogcmVzb2x2ZXIuZmllbGROYW1lLFxuICAgICAgICAgICAgZGF0YVNvdXJjZTogaHR0cERhdGFTb3VyY2UsXG4gICAgICAgICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBNYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhcbiAgICAgICAgICAgICAgcmVzb2x2ZXIuZGVmYXVsdFJlcXVlc3RNYXBwaW5nVGVtcGxhdGUsXG4gICAgICAgICAgICApLFxuICAgICAgICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IE1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKFxuICAgICAgICAgICAgICByZXNvbHZlci5kZWZhdWx0UmVzcG9uc2VNYXBwaW5nVGVtcGxhdGUsXG4gICAgICAgICAgICApLFxuICAgICAgICAgIH0sXG4gICAgICAgICk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGhpcyB0YWtlcyBvbmUgb2YgdGhlIGF1dG9nZW5lcmF0ZWQgcG9saWNpZXMgZnJvbSBBV1MgYW5kIGJ1aWxkcyB0aGUgbGlzdCBvZiBBUk5zIGZvciBncmFudGluZyBHcmFwaFFMIGFjY2VzcyBsYXRlclxuICAgKiBAcGFyYW0gcG9saWN5IFRoZSBhdXRvIGdlbmVyYXRlZCBwb2xpY3kgZnJvbSB0aGUgQXBwU3luYyBUcmFuc2Zvcm1lcnNcbiAgICogQHJldHVybnMgQW4gYXJyYXkgb2YgcmVzb3VyY2UgYXJucyBmb3IgdXNlIHdpdGggZ3JhbnRzXG4gICAqL1xuICBwcml2YXRlIGdldFJlc291cmNlc0Zyb21HZW5lcmF0ZWRSb2xlUG9saWN5KHBvbGljeT86IFJlc291cmNlKTogc3RyaW5nW10ge1xuICAgIGlmICghcG9saWN5Py5Qcm9wZXJ0aWVzPy5Qb2xpY3lEb2N1bWVudD8uU3RhdGVtZW50KSByZXR1cm4gW107XG5cbiAgICBjb25zdCB7IHJlZ2lvbiwgYWNjb3VudCB9ID0gdGhpcy5uZXN0ZWRBcHBzeW5jU3RhY2s7XG5cbiAgICBjb25zdCByZXNvbHZlZFJlc291cmNlczogc3RyaW5nW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHN0YXRlbWVudCBvZiBwb2xpY3kuUHJvcGVydGllcy5Qb2xpY3lEb2N1bWVudC5TdGF0ZW1lbnQpIHtcbiAgICAgIGNvbnN0IHsgUmVzb3VyY2U6IHJlc291cmNlcyA9IFtdIH0gPSBzdGF0ZW1lbnQgPz8ge307XG4gICAgICBmb3IgKGNvbnN0IHJlc291cmNlIG9mIHJlc291cmNlcykge1xuICAgICAgICBjb25zdCBzdWJzID0gcmVzb3VyY2VbJ0ZuOjpTdWInXVsxXTtcbiAgICAgICAgY29uc3QgeyB0eXBlTmFtZSwgZmllbGROYW1lIH0gPSBzdWJzID8/IHt9O1xuICAgICAgICBpZiAoZmllbGROYW1lKSB7XG4gICAgICAgICAgcmVzb2x2ZWRSZXNvdXJjZXMucHVzaChgYXJuOmF3czphcHBzeW5jOiR7cmVnaW9ufToke2FjY291bnR9OmFwaXMvJHt0aGlzLmFwcHN5bmNBUEkuYXBpSWR9L3R5cGVzLyR7dHlwZU5hbWV9L2ZpZWxkcy8ke2ZpZWxkTmFtZX1gKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXNvbHZlZFJlc291cmNlcy5wdXNoKGBhcm46YXdzOmFwcHN5bmM6JHtyZWdpb259OiR7YWNjb3VudH06YXBpcy8ke3RoaXMuYXBwc3luY0FQSS5hcGlJZH0vdHlwZXMvJHt0eXBlTmFtZX0vKmApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc29sdmVkUmVzb3VyY2VzO1xuICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICBwdWJsaWMgYWRkTGFtYmRhRGF0YVNvdXJjZUFuZFJlc29sdmVycyhcbiAgICBmdW5jdGlvbk5hbWU6IHN0cmluZyxcbiAgICBpZDogc3RyaW5nLFxuICAgIGxhbWJkYUZ1bmN0aW9uOiBJRnVuY3Rpb24sXG4gICAgb3B0aW9ucz86IERhdGFTb3VyY2VPcHRpb25zLFxuICApOiBMYW1iZGFEYXRhU291cmNlIHtcbiAgICBjb25zdCBmdW5jdGlvbkRhdGFTb3VyY2UgPSB0aGlzLmFwcHN5bmNBUEkuYWRkTGFtYmRhRGF0YVNvdXJjZShcbiAgICAgIGlkLFxuICAgICAgbGFtYmRhRnVuY3Rpb24sXG4gICAgICBvcHRpb25zLFxuICAgICk7XG5cbiAgICBmb3IgKGNvbnN0IHJlc29sdmVyIG9mIHRoaXMuZnVuY3Rpb25SZXNvbHZlcnNbZnVuY3Rpb25OYW1lXSkge1xuICAgICAgbmV3IFJlc29sdmVyKFxuICAgICAgICB0aGlzLm5lc3RlZEFwcHN5bmNTdGFjayxcbiAgICAgICAgYCR7cmVzb2x2ZXIudHlwZU5hbWV9LSR7cmVzb2x2ZXIuZmllbGROYW1lfS1yZXNvbHZlcmAsXG4gICAgICAgIHtcbiAgICAgICAgICBhcGk6IHRoaXMuYXBwc3luY0FQSSxcbiAgICAgICAgICB0eXBlTmFtZTogcmVzb2x2ZXIudHlwZU5hbWUsXG4gICAgICAgICAgZmllbGROYW1lOiByZXNvbHZlci5maWVsZE5hbWUsXG4gICAgICAgICAgZGF0YVNvdXJjZTogZnVuY3Rpb25EYXRhU291cmNlLFxuICAgICAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IE1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKFxuICAgICAgICAgICAgcmVzb2x2ZXIuZGVmYXVsdFJlcXVlc3RNYXBwaW5nVGVtcGxhdGUsXG4gICAgICAgICAgKSxcbiAgICAgICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoXG4gICAgICAgICAgICByZXNvbHZlci5kZWZhdWx0UmVzcG9uc2VNYXBwaW5nVGVtcGxhdGUsXG4gICAgICAgICAgKSwgLy8gVGhpcyBkZWZhdWx0cyB0byBhbGxvdyBlcnJvcnMgdG8gcmV0dXJuIHRvIHRoZSBjbGllbnQgaW5zdGVhZCBvZiB0aHJvd2luZ1xuICAgICAgICB9LFxuICAgICAgKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZnVuY3Rpb25EYXRhU291cmNlO1xuICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIGFkZER5bmFtb0RCU3RyZWFtKHByb3BzOiBEeW5hbW9EQlN0cmVhbVByb3BzKTogc3RyaW5nIHtcbiAgICBjb25zdCB0YWJsZU5hbWUgPSBgJHtwcm9wcy5tb2RlbFR5cGVOYW1lfVRhYmxlYDtcbiAgICBjb25zdCB0YWJsZSA9IHRoaXMudGFibGVNYXBbdGFibGVOYW1lXTtcbiAgICBpZiAoIXRhYmxlKSB0aHJvdyBuZXcgRXJyb3IoYFRhYmxlIHdpdGggbmFtZSAnJHt0YWJsZU5hbWV9JyBub3QgZm91bmQuYCk7XG5cbiAgICBjb25zdCBjZm5UYWJsZSA9IHRhYmxlLm5vZGUuZGVmYXVsdENoaWxkIGFzIENmblRhYmxlO1xuICAgIGNmblRhYmxlLnN0cmVhbVNwZWNpZmljYXRpb24gPSB7XG4gICAgICBzdHJlYW1WaWV3VHlwZTogcHJvcHMuc3RyZWFtVmlld1R5cGUsXG4gICAgfTtcblxuICAgIHJldHVybiBjZm5UYWJsZS5hdHRyU3RyZWFtQXJuO1xuICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgcHVibGljIG92ZXJyaWRlUmVzb2x2ZXIocHJvcHM6IE92ZXJyaWRlUmVzb2x2ZXJQcm9wcykge1xuICAgIGNvbnN0IHJlc29sdmVyID0gdGhpcy5uZXN0ZWRBcHBzeW5jU3RhY2subm9kZS50cnlGaW5kQ2hpbGQoYCR7cHJvcHMudHlwZU5hbWV9LSR7cHJvcHMuZmllbGROYW1lfS1yZXNvbHZlcmApIGFzIFJlc29sdmVyO1xuICAgIGlmICghcmVzb2x2ZXIpIHRocm93IG5ldyBFcnJvcihgUmVzb2x2ZXIgd2l0aCB0eXBlTmFtZSAnJHtwcm9wcy50eXBlTmFtZX0nIGFuZCBmaWVsZE5hbWUgJyR7cHJvcHMuZmllbGROYW1lfScgbm90IGZvdW5kYCk7XG5cbiAgICBjb25zdCBjZm5SZXNvbHZlciA9IHJlc29sdmVyLm5vZGUuZGVmYXVsdENoaWxkIGFzIENmblJlc29sdmVyO1xuICAgIGlmICghY2ZuUmVzb2x2ZXIpIHRocm93IG5ldyBFcnJvcihgUmVzb2x2ZXIgd2l0aCB0eXBlTmFtZSAnJHtwcm9wcy50eXBlTmFtZX0nIGFuZCBmaWVsZE5hbWUgJyR7cHJvcHMuZmllbGROYW1lfScgbm90IGZvdW5kYCk7XG5cbiAgICBpZiAocHJvcHMucmVxdWVzdE1hcHBpbmdUZW1wbGF0ZUZpbGUpIHtcbiAgICAgIGNmblJlc29sdmVyLnJlcXVlc3RNYXBwaW5nVGVtcGxhdGUgPSBmcy5yZWFkRmlsZVN5bmMocHJvcHMucmVxdWVzdE1hcHBpbmdUZW1wbGF0ZUZpbGUpLnRvU3RyaW5nKCd1dGYtOCcpO1xuICAgIH1cblxuICAgIGlmIChwcm9wcy5yZXNwb25zZU1hcHBpbmdUZW1wbGF0ZUZpbGUpIHtcbiAgICAgIGNmblJlc29sdmVyLnJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlID0gZnMucmVhZEZpbGVTeW5jKHByb3BzLnJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlRmlsZSkudG9TdHJpbmcoJ3V0Zi04Jyk7XG4gICAgfVxuICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICBwdWJsaWMgZ3JhbnRQdWJsaWMoZ3JhbnRlZTogSUdyYW50YWJsZSk6IEdyYW50IHtcbiAgICByZXR1cm4gR3JhbnQuYWRkVG9QcmluY2lwYWwoe1xuICAgICAgZ3JhbnRlZSxcbiAgICAgIGFjdGlvbnM6IFsnYXBwc3luYzpHcmFwaFFMJ10sXG4gICAgICByZXNvdXJjZUFybnM6IHRoaXMucHVibGljUmVzb3VyY2VBcm5zLFxuICAgICAgc2NvcGU6IHRoaXMsXG4gICAgfSk7XG4gIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICBwdWJsaWMgZ3JhbnRQcml2YXRlKGdyYW50ZWU6IElHcmFudGFibGUpOiBHcmFudCB7XG4gICAgcmV0dXJuIEdyYW50LmFkZFRvUHJpbmNpcGFsKHtcbiAgICAgIGdyYW50ZWUsXG4gICAgICBhY3Rpb25zOiBbJ2FwcHN5bmM6R3JhcGhRTCddLFxuICAgICAgcmVzb3VyY2VBcm5zOiB0aGlzLnByaXZhdGVSZXNvdXJjZUFybnMsXG4gICAgfSk7XG4gIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBEeW5hbW9EQlN0cmVhbVByb3BzIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IG1vZGVsVHlwZU5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgc3RyZWFtVmlld1R5cGU6IFN0cmVhbVZpZXdUeXBlO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIE92ZXJyaWRlUmVzb2x2ZXJQcm9wcyB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IHR5cGVOYW1lOiBzdHJpbmc7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IGZpZWxkTmFtZTogc3RyaW5nO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gIHJlYWRvbmx5IHJlcXVlc3RNYXBwaW5nVGVtcGxhdGVGaWxlPzogc3RyaW5nO1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICByZWFkb25seSByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZUZpbGU/OiBzdHJpbmc7XG59Il19