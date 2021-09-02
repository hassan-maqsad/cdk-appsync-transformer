"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CdkTransformer = void 0;
const aws_appsync_1 = require("@aws-cdk/aws-appsync");
const graphql_transformer_core_1 = require("graphql-transformer-core");
const graphqlTypeStatements = ['Query', 'Mutation', 'Subscription'];
class CdkTransformer extends graphql_transformer_core_1.Transformer {
    constructor() {
        super('CdkTransformer', 'directive @nullable on FIELD_DEFINITION');
        this.after = (ctx) => {
            this.buildResources(ctx);
            // TODO: Improve this iteration
            Object.keys(this.tables).forEach(tableName => {
                let table = this.tables[tableName];
                Object.keys(this.resolverTableMap).forEach(resolverName => {
                    if (this.resolverTableMap[resolverName] === tableName)
                        table.resolvers.push(resolverName);
                });
                Object.keys(this.gsiResolverTableMap).forEach(resolverName => {
                    if (this.gsiResolverTableMap[resolverName] === tableName)
                        table.gsiResolvers.push(resolverName);
                });
            });
            // @ts-ignore - we are overloading the use of outputs here...
            ctx.setOutput('cdkTables', this.tables);
            // @ts-ignore - we are overloading the use of outputs here...
            ctx.setOutput('noneResolvers', this.noneDataSources);
            // @ts-ignore - we are overloading the use of outputs here...
            ctx.setOutput('functionResolvers', this.functionResolvers);
            // @ts-ignore - we are overloading the use of outputs here...
            ctx.setOutput('httpResolvers', this.httpResolvers);
            const query = ctx.getQuery();
            if (query) {
                const queryFields = graphql_transformer_core_1.getFieldArguments(query);
                ctx.setOutput('queries', queryFields);
            }
            const mutation = ctx.getMutation();
            if (mutation) {
                const mutationFields = graphql_transformer_core_1.getFieldArguments(mutation);
                ctx.setOutput('mutations', mutationFields);
            }
            const subscription = ctx.getSubscription();
            if (subscription) {
                const subscriptionFields = graphql_transformer_core_1.getFieldArguments(subscription);
                ctx.setOutput('subscriptions', subscriptionFields);
            }
        };
        this.tables = {};
        this.noneDataSources = {};
        this.functionResolvers = {};
        this.httpResolvers = {};
        this.resolverTableMap = {};
        this.gsiResolverTableMap = {};
    }
    buildResources(ctx) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
        const templateResources = ctx.template.Resources;
        if (!templateResources)
            return;
        for (const [resourceName, resource] of Object.entries(templateResources)) {
            if (resource.Type === 'AWS::DynamoDB::Table') {
                this.buildTablesFromResource(resourceName, ctx);
            }
            else if (resource.Type === 'AWS::AppSync::Resolver') {
                if (((_a = resource.Properties) === null || _a === void 0 ? void 0 : _a.DataSourceName) === 'NONE') {
                    this.noneDataSources[`${resource.Properties.TypeName}${resource.Properties.FieldName}`] = {
                        typeName: resource.Properties.TypeName,
                        fieldName: resource.Properties.FieldName,
                    };
                }
                else if (((_b = resource.Properties) === null || _b === void 0 ? void 0 : _b.Kind) === 'PIPELINE') {
                    // Inspired by:
                    // https://github.com/aws-amplify/amplify-cli/blob/master/packages/graphql-function-transformer/src/__tests__/FunctionTransformer.test.ts#L20
                    const dependsOn = (_c = resource.DependsOn) !== null && _c !== void 0 ? _c : '';
                    const functionConfiguration = templateResources[dependsOn];
                    const functionDependsOn = (_d = functionConfiguration.DependsOn) !== null && _d !== void 0 ? _d : '';
                    const functionDataSource = templateResources[functionDependsOn];
                    const functionArn = (_g = (_f = (_e = functionDataSource.Properties) === null || _e === void 0 ? void 0 : _e.LambdaConfig) === null || _f === void 0 ? void 0 : _f.LambdaFunctionArn) === null || _g === void 0 ? void 0 : _g.payload[1].payload[0];
                    const functionName = functionArn.split(':').slice(-1)[0];
                    const fieldName = resource.Properties.FieldName;
                    const typeName = resource.Properties.TypeName;
                    if (!this.functionResolvers[functionName])
                        this.functionResolvers[functionName] = [];
                    this.functionResolvers[functionName].push({
                        typeName: typeName,
                        fieldName: fieldName,
                        defaultRequestMappingTemplate: aws_appsync_1.MappingTemplate.lambdaRequest().renderTemplate(),
                        defaultResponseMappingTemplate: (_h = functionConfiguration.Properties) === null || _h === void 0 ? void 0 : _h.ResponseMappingTemplate,
                    });
                }
                else { // Should be a table/model resolver -> Maybe not true when we add in @searchable, etc
                    const dataSourceName = (_k = (_j = resource.Properties) === null || _j === void 0 ? void 0 : _j.DataSourceName) === null || _k === void 0 ? void 0 : _k.payload[0];
                    const dataSource = templateResources[dataSourceName];
                    const dataSourceType = (_l = dataSource.Properties) === null || _l === void 0 ? void 0 : _l.Type;
                    let typeName = (_m = resource.Properties) === null || _m === void 0 ? void 0 : _m.TypeName;
                    let fieldName = (_o = resource.Properties) === null || _o === void 0 ? void 0 : _o.FieldName;
                    switch (dataSourceType) {
                        case 'AMAZON_DYNAMODB':
                            let tableName = dataSourceName.replace('DataSource', 'Table');
                            if (graphqlTypeStatements.indexOf(typeName) >= 0) {
                                this.resolverTableMap[fieldName] = tableName;
                            }
                            else { // this is a GSI
                                this.gsiResolverTableMap[`${typeName}${fieldName}`] = tableName;
                            }
                            break;
                        case 'HTTP':
                            const httpConfig = (_p = dataSource.Properties) === null || _p === void 0 ? void 0 : _p.HttpConfig;
                            const endpoint = httpConfig.Endpoint;
                            if (!this.httpResolvers[endpoint])
                                this.httpResolvers[endpoint] = [];
                            this.httpResolvers[endpoint].push({
                                typeName,
                                fieldName,
                                httpConfig,
                                defaultRequestMappingTemplate: (_q = resource.Properties) === null || _q === void 0 ? void 0 : _q.RequestMappingTemplate,
                                defaultResponseMappingTemplate: (_r = resource.Properties) === null || _r === void 0 ? void 0 : _r.ResponseMappingTemplate,
                            });
                            break;
                        default:
                            throw new Error(`Unsupported Data Source Type: ${dataSourceType}`);
                    }
                }
            }
        }
    }
    buildTablesFromResource(resourceName, ctx) {
        var _a, _b, _c, _d, _e;
        const tableResource = ctx.template.Resources ? ctx.template.Resources[resourceName] : undefined;
        const attributeDefinitions = (_a = tableResource === null || tableResource === void 0 ? void 0 : tableResource.Properties) === null || _a === void 0 ? void 0 : _a.AttributeDefinitions;
        const keySchema = (_b = tableResource === null || tableResource === void 0 ? void 0 : tableResource.Properties) === null || _b === void 0 ? void 0 : _b.KeySchema;
        const keys = this.parseKeySchema(keySchema, attributeDefinitions);
        let ttl = (_c = tableResource === null || tableResource === void 0 ? void 0 : tableResource.Properties) === null || _c === void 0 ? void 0 : _c.TimeToLiveSpecification;
        if (ttl) {
            ttl = {
                attributeName: ttl.AttributeName,
                enabled: ttl.Enabled,
            };
        }
        let table = {
            tableName: resourceName,
            partitionKey: keys.partitionKey,
            sortKey: keys.sortKey,
            ttl: ttl,
            localSecondaryIndexes: [],
            globalSecondaryIndexes: [],
            resolvers: [],
            gsiResolvers: [],
        };
        const lsis = (_d = tableResource === null || tableResource === void 0 ? void 0 : tableResource.Properties) === null || _d === void 0 ? void 0 : _d.LocalSecondaryIndexes;
        if (lsis) {
            lsis.forEach((lsi) => {
                const lsiKeys = this.parseKeySchema(lsi.KeySchema, attributeDefinitions);
                const lsiDefinition = {
                    indexName: lsi.IndexName,
                    projection: lsi.Projection,
                    sortKey: lsiKeys.sortKey,
                };
                table.localSecondaryIndexes.push(lsiDefinition);
            });
        }
        const gsis = (_e = tableResource === null || tableResource === void 0 ? void 0 : tableResource.Properties) === null || _e === void 0 ? void 0 : _e.GlobalSecondaryIndexes;
        if (gsis) {
            gsis.forEach((gsi) => {
                const gsiKeys = this.parseKeySchema(gsi.KeySchema, attributeDefinitions);
                const gsiDefinition = {
                    indexName: gsi.IndexName,
                    projection: gsi.Projection,
                    partitionKey: gsiKeys.partitionKey,
                    sortKey: gsiKeys.sortKey,
                };
                table.globalSecondaryIndexes.push(gsiDefinition);
            });
        }
        this.tables[resourceName] = table;
    }
    parseKeySchema(keySchema, attributeDefinitions) {
        let partitionKey = {};
        let sortKey = {};
        keySchema.forEach((key) => {
            const keyType = key.KeyType;
            const attributeName = key.AttributeName;
            const attribute = attributeDefinitions.find((attr) => attr.AttributeName === attributeName);
            if (keyType === 'HASH') {
                partitionKey = {
                    name: attribute.AttributeName,
                    type: attribute.AttributeType,
                };
            }
            else if (keyType === 'RANGE') {
                sortKey = {
                    name: attribute.AttributeName,
                    type: attribute.AttributeType,
                };
            }
        });
        return { partitionKey, sortKey };
    }
}
exports.CdkTransformer = CdkTransformer;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2RrLXRyYW5zZm9ybWVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3RyYW5zZm9ybWVyL2Nkay10cmFuc2Zvcm1lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxzREFBdUQ7QUFDdkQsdUVBQThGO0FBRTlGLE1BQU0scUJBQXFCLEdBQUcsQ0FBQyxPQUFPLEVBQUUsVUFBVSxFQUFFLGNBQWMsQ0FBQyxDQUFDO0FBb0RwRSxNQUFhLGNBQWUsU0FBUSxzQ0FBVztJQVE3QztRQUNFLEtBQUssQ0FDSCxnQkFBZ0IsRUFDaEIseUNBQXlDLENBQzFDLENBQUM7UUFVRyxVQUFLLEdBQUcsQ0FBQyxHQUF1QixFQUFRLEVBQUU7WUFDL0MsSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUV6QiwrQkFBK0I7WUFDL0IsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxFQUFFO2dCQUMzQyxJQUFJLEtBQUssR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUNuQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsRUFBRTtvQkFDeEQsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsWUFBWSxDQUFDLEtBQUssU0FBUzt3QkFBRSxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztnQkFDNUYsQ0FBQyxDQUFDLENBQUM7Z0JBRUgsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLEVBQUU7b0JBQzNELElBQUksSUFBSSxDQUFDLG1CQUFtQixDQUFDLFlBQVksQ0FBQyxLQUFLLFNBQVM7d0JBQUUsS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLENB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LWFwcHN5bmMnO1xuaW1wb3J0IHsgVHJhbnNmb3JtZXIsIFRyYW5zZm9ybWVyQ29udGV4dCwgZ2V0RmllbGRBcmd1bWVudHMgfSBmcm9tICdncmFwaHFsLXRyYW5zZm9ybWVyLWNvcmUnO1xuXG5jb25zdCBncmFwaHFsVHlwZVN0YXRlbWVudHMgPSBbJ1F1ZXJ5JywgJ011dGF0aW9uJywgJ1N1YnNjcmlwdGlvbiddO1xuXG5leHBvcnQgaW50ZXJmYWNlIENka1RyYW5zZm9ybWVyVGFibGVLZXkge1xuICByZWFkb25seSBuYW1lOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHR5cGU6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDZGtUcmFuc2Zvcm1lckxvY2FsU2Vjb25kYXJ5SW5kZXgge1xuICByZWFkb25seSBpbmRleE5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgcHJvamVjdGlvbjogYW55O1xuICByZWFkb25seSBzb3J0S2V5OiBDZGtUcmFuc2Zvcm1lclRhYmxlS2V5O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIENka1RyYW5zZm9ybWVyR2xvYmFsU2Vjb25kYXJ5SW5kZXgge1xuICByZWFkb25seSBpbmRleE5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgcHJvamVjdGlvbjogYW55O1xuICByZWFkb25seSBwYXJ0aXRpb25LZXk6IENka1RyYW5zZm9ybWVyVGFibGVLZXk7XG4gIHJlYWRvbmx5IHNvcnRLZXk6IENka1RyYW5zZm9ybWVyVGFibGVLZXk7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2RrVHJhbnNmb3JtZXJUYWJsZVR0bCB7XG4gIHJlYWRvbmx5IGF0dHJpYnV0ZU5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgZW5hYmxlZDogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDZGtUcmFuc2Zvcm1lclRhYmxlIHtcbiAgcmVhZG9ubHkgdGFibGVOYW1lOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHBhcnRpdGlvbktleTogQ2RrVHJhbnNmb3JtZXJUYWJsZUtleTtcbiAgcmVhZG9ubHkgc29ydEtleT86IENka1RyYW5zZm9ybWVyVGFibGVLZXk7XG4gIHJlYWRvbmx5IHR0bD86IENka1RyYW5zZm9ybWVyVGFibGVUdGw7XG4gIHJlYWRvbmx5IGxvY2FsU2Vjb25kYXJ5SW5kZXhlczogQ2RrVHJhbnNmb3JtZXJMb2NhbFNlY29uZGFyeUluZGV4W107XG4gIHJlYWRvbmx5IGdsb2JhbFNlY29uZGFyeUluZGV4ZXM6IENka1RyYW5zZm9ybWVyR2xvYmFsU2Vjb25kYXJ5SW5kZXhbXTtcbiAgcmVhZG9ubHkgcmVzb2x2ZXJzOiBzdHJpbmdbXTtcbiAgcmVhZG9ubHkgZ3NpUmVzb2x2ZXJzOiBzdHJpbmdbXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDZGtUcmFuc2Zvcm1lclJlc29sdmVyIHtcbiAgcmVhZG9ubHkgdHlwZU5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgZmllbGROYW1lOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2RrVHJhbnNmb3JtZXJIdHRwUmVzb2x2ZXIgZXh0ZW5kcyBDZGtUcmFuc2Zvcm1lclJlc29sdmVyIHtcbiAgcmVhZG9ubHkgaHR0cENvbmZpZzogYW55O1xuICByZWFkb25seSBkZWZhdWx0UmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogc3RyaW5nO1xuICByZWFkb25seSBkZWZhdWx0UmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDZGtUcmFuc2Zvcm1lckZ1bmN0aW9uUmVzb2x2ZXIgZXh0ZW5kcyBDZGtUcmFuc2Zvcm1lclJlc29sdmVyIHtcbiAgcmVhZG9ubHkgZGVmYXVsdFJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IHN0cmluZztcbiAgcmVhZG9ubHkgZGVmYXVsdFJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBDZGtUcmFuc2Zvcm1lciBleHRlbmRzIFRyYW5zZm9ybWVyIHtcbiAgdGFibGVzOiB7IFtuYW1lOiBzdHJpbmddOiBDZGtUcmFuc2Zvcm1lclRhYmxlIH07XG4gIG5vbmVEYXRhU291cmNlczogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJSZXNvbHZlciB9O1xuICBmdW5jdGlvblJlc29sdmVyczogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJGdW5jdGlvblJlc29sdmVyW10gfTtcbiAgaHR0cFJlc29sdmVyczogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJIdHRwUmVzb2x2ZXJbXSB9O1xuICByZXNvbHZlclRhYmxlTWFwOiB7IFtuYW1lOiBzdHJpbmddOiBzdHJpbmcgfTtcbiAgZ3NpUmVzb2x2ZXJUYWJsZU1hcDogeyBbbmFtZTogc3RyaW5nXTogc3RyaW5nIH07XG5cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoXG4gICAgICAnQ2RrVHJhbnNmb3JtZXInLFxuICAgICAgJ2RpcmVjdGl2ZSBAbnVsbGFibGUgb24gRklFTERfREVGSU5JVElPTicsIC8vIHRoaXMgaXMgdW51c2VkXG4gICAgKTtcblxuICAgIHRoaXMudGFibGVzID0ge307XG4gICAgdGhpcy5ub25lRGF0YVNvdXJjZXMgPSB7fTtcbiAgICB0aGlzLmZ1bmN0aW9uUmVzb2x2ZXJzID0ge307XG4gICAgdGhpcy5odHRwUmVzb2x2ZXJzID0ge307XG4gICAgdGhpcy5yZXNvbHZlclRhYmxlTWFwID0ge307XG4gICAgdGhpcy5nc2lSZXNvbHZlclRhYmxlTWFwID0ge307XG4gIH1cblxuICBwdWJsaWMgYWZ0ZXIgPSAoY3R4OiBUcmFuc2Zvcm1lckNvbnRleHQpOiB2b2lkID0+IHtcbiAgICB0aGlzLmJ1aWxkUmVzb3VyY2VzKGN0eCk7XG5cbiAgICAvLyBUT0RPOiBJbXByb3ZlIHRoaXMgaXRlcmF0aW9uXG4gICAgT2JqZWN0LmtleXModGhpcy50YWJsZXMpLmZvckVhY2godGFibGVOYW1lID0+IHtcbiAgICAgIGxldCB0YWJsZSA9IHRoaXMudGFibGVzW3RhYmxlTmFtZV07XG4gICAgICBPYmplY3Qua2V5cyh0aGlzLnJlc29sdmVyVGFibGVNYXApLmZvckVhY2gocmVzb2x2ZXJOYW1lID0+IHtcbiAgICAgICAgaWYgKHRoaXMucmVzb2x2ZXJUYWJsZU1hcFtyZXNvbHZlck5hbWVdID09PSB0YWJsZU5hbWUpIHRhYmxlLnJlc29sdmVycy5wdXNoKHJlc29sdmVyTmFtZSk7XG4gICAgICB9KTtcblxuICAgICAgT2JqZWN0LmtleXModGhpcy5nc2lSZXNvbHZlclRhYmxlTWFwKS5mb3JFYWNoKHJlc29sdmVyTmFtZSA9PiB7XG4gICAgICAgIGlmICh0aGlzLmdzaVJlc29sdmVyVGFibGVNYXBbcmVzb2x2ZXJOYW1lXSA9PT0gdGFibGVOYW1lKSB0YWJsZS5nc2lSZXNvbHZlcnMucHVzaChyZXNvbHZlck5hbWUpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBAdHMtaWdub3JlIC0gd2UgYXJlIG92ZXJsb2FkaW5nIHRoZSB1c2Ugb2Ygb3V0cHV0cyBoZXJlLi4uXG4gICAgY3R4LnNldE91dHB1dCgnY2RrVGFibGVzJywgdGhpcy50YWJsZXMpO1xuXG4gICAgLy8gQHRzLWlnbm9yZSAtIHdlIGFyZSBvdmVybG9hZGluZyB0aGUgdXNlIG9mIG91dHB1dHMgaGVyZS4uLlxuICAgIGN0eC5zZXRPdXRwdXQoJ25vbmVSZXNvbHZlcnMnLCB0aGlzLm5vbmVEYXRhU291cmNlcyk7XG5cbiAgICAvLyBAdHMtaWdub3JlIC0gd2UgYXJlIG92ZXJsb2FkaW5nIHRoZSB1c2Ugb2Ygb3V0cHV0cyBoZXJlLi4uXG4gICAgY3R4LnNldE91dHB1dCgnZnVuY3Rpb25SZXNvbHZlcnMnLCB0aGlzLmZ1bmN0aW9uUmVzb2x2ZXJzKTtcblxuICAgIC8vIEB0cy1pZ25vcmUgLSB3ZSBhcmUgb3ZlcmxvYWRpbmcgdGhlIHVzZSBvZiBvdXRwdXRzIGhlcmUuLi5cbiAgICBjdHguc2V0T3V0cHV0KCdodHRwUmVzb2x2ZXJzJywgdGhpcy5odHRwUmVzb2x2ZXJzKTtcblxuICAgIGNvbnN0IHF1ZXJ5ID0gY3R4LmdldFF1ZXJ5KCk7XG4gICAgaWYgKHF1ZXJ5KSB7XG4gICAgICBjb25zdCBxdWVyeUZpZWxkcyA9IGdldEZpZWxkQXJndW1lbnRzKHF1ZXJ5KTtcbiAgICAgIGN0eC5zZXRPdXRwdXQoJ3F1ZXJpZXMnLCBxdWVyeUZpZWxkcyk7XG4gICAgfVxuXG4gICAgY29uc3QgbXV0YXRpb24gPSBjdHguZ2V0TXV0YXRpb24oKTtcbiAgICBpZiAobXV0YXRpb24pIHtcbiAgICAgIGNvbnN0IG11dGF0aW9uRmllbGRzID0gZ2V0RmllbGRBcmd1bWVudHMobXV0YXRpb24pO1xuICAgICAgY3R4LnNldE91dHB1dCgnbXV0YXRpb25zJywgbXV0YXRpb25GaWVsZHMpO1xuICAgIH1cblxuICAgIGNvbnN0IHN1YnNjcmlwdGlvbiA9IGN0eC5nZXRTdWJzY3JpcHRpb24oKTtcbiAgICBpZiAoc3Vic2NyaXB0aW9uKSB7XG4gICAgICBjb25zdCBzdWJzY3JpcHRpb25GaWVsZHMgPSBnZXRGaWVsZEFyZ3VtZW50cyhzdWJzY3JpcHRpb24pO1xuICAgICAgY3R4LnNldE91dHB1dCgnc3Vic2NyaXB0aW9ucycsIHN1YnNjcmlwdGlvbkZpZWxkcyk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBidWlsZFJlc291cmNlcyhjdHg6IFRyYW5zZm9ybWVyQ29udGV4dCk6IHZvaWQge1xuICAgIGNvbnN0IHRlbXBsYXRlUmVzb3VyY2VzID0gY3R4LnRlbXBsYXRlLlJlc291cmNlcztcbiAgICBpZiAoIXRlbXBsYXRlUmVzb3VyY2VzKSByZXR1cm47XG5cbiAgICBmb3IgKGNvbnN0IFtyZXNvdXJjZU5hbWUsIHJlc291cmNlXSBvZiBPYmplY3QuZW50cmllcyh0ZW1wbGF0ZVJlc291cmNlcykpIHtcbiAgICAgIGlmIChyZXNvdXJjZS5UeXBlID09PSAnQVdTOjpEeW5hbW9EQjo6VGFibGUnKSB7XG4gICAgICAgIHRoaXMuYnVpbGRUYWJsZXNGcm9tUmVzb3VyY2UocmVzb3VyY2VOYW1lLCBjdHgpO1xuICAgICAgfSBlbHNlIGlmIChyZXNvdXJjZS5UeXBlID09PSAnQVdTOjpBcHBTeW5jOjpSZXNvbHZlcicpIHtcbiAgICAgICAgaWYgKHJlc291cmNlLlByb3BlcnRpZXM/LkRhdGFTb3VyY2VOYW1lID09PSAnTk9ORScpIHtcbiAgICAgICAgICB0aGlzLm5vbmVEYXRhU291cmNlc1tgJHtyZXNvdXJjZS5Qcm9wZXJ0aWVzLlR5cGVOYW1lfSR7cmVzb3VyY2UuUHJvcGVydGllcy5GaWVsZE5hbWV9YF0gPSB7XG4gICAgICAgICAgICB0eXBlTmFtZTogcmVzb3VyY2UuUHJvcGVydGllcy5UeXBlTmFtZSxcbiAgICAgICAgICAgIGZpZWxkTmFtZTogcmVzb3VyY2UuUHJvcGVydGllcy5GaWVsZE5hbWUsXG4gICAgICAgICAgfTtcbiAgICAgICAgfSBlbHNlIGlmIChyZXNvdXJjZS5Qcm9wZXJ0aWVzPy5LaW5kID09PSAnUElQRUxJTkUnKSB7XG4gICAgICAgICAgLy8gSW5zcGlyZWQgYnk6XG4gICAgICAgICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL2F3cy1hbXBsaWZ5L2FtcGxpZnktY2xpL2Jsb2IvbWFzdGVyL3BhY2thZ2VzL2dyYXBocWwtZnVuY3Rpb24tdHJhbnNmb3JtZXIvc3JjL19fdGVzdHNfXy9GdW5jdGlvblRyYW5zZm9ybWVyLnRlc3QudHMjTDIwXG4gICAgICAgICAgY29uc3QgZGVwZW5kc09uID0gcmVzb3VyY2UuRGVwZW5kc09uIGFzIHN0cmluZyA/PyAnJztcbiAgICAgICAgICBjb25zdCBmdW5jdGlvbkNvbmZpZ3VyYXRpb24gPSB0ZW1wbGF0ZVJlc291cmNlc1tkZXBlbmRzT25dO1xuICAgICAgICAgIGNvbnN0IGZ1bmN0aW9uRGVwZW5kc09uID0gZnVuY3Rpb25Db25maWd1cmF0aW9uLkRlcGVuZHNPbiBhcyBzdHJpbmcgPz8gJyc7XG4gICAgICAgICAgY29uc3QgZnVuY3Rpb25EYXRhU291cmNlID0gdGVtcGxhdGVSZXNvdXJjZXNbZnVuY3Rpb25EZXBlbmRzT25dO1xuICAgICAgICAgIGNvbnN0IGZ1bmN0aW9uQXJuID0gZnVuY3Rpb25EYXRhU291cmNlLlByb3BlcnRpZXM/LkxhbWJkYUNvbmZpZz8uTGFtYmRhRnVuY3Rpb25Bcm4/LnBheWxvYWRbMV0ucGF5bG9hZFswXTtcbiAgICAgICAgICBjb25zdCBmdW5jdGlvbk5hbWUgPSBmdW5jdGlvbkFybi5zcGxpdCgnOicpLnNsaWNlKC0xKVswXTtcblxuICAgICAgICAgIGNvbnN0IGZpZWxkTmFtZSA9IHJlc291cmNlLlByb3BlcnRpZXMuRmllbGROYW1lO1xuICAgICAgICAgIGNvbnN0IHR5cGVOYW1lID0gcmVzb3VyY2UuUHJvcGVydGllcy5UeXBlTmFtZTtcblxuICAgICAgICAgIGlmICghdGhpcy5mdW5jdGlvblJlc29sdmVyc1tmdW5jdGlvbk5hbWVdKSB0aGlzLmZ1bmN0aW9uUmVzb2x2ZXJzW2Z1bmN0aW9uTmFtZV0gPSBbXTtcblxuICAgICAgICAgIHRoaXMuZnVuY3Rpb25SZXNvbHZlcnNbZnVuY3Rpb25OYW1lXS5wdXNoKHtcbiAgICAgICAgICAgIHR5cGVOYW1lOiB0eXBlTmFtZSxcbiAgICAgICAgICAgIGZpZWxkTmFtZTogZmllbGROYW1lLFxuICAgICAgICAgICAgZGVmYXVsdFJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IE1hcHBpbmdUZW1wbGF0ZS5sYW1iZGFSZXF1ZXN0KCkucmVuZGVyVGVtcGxhdGUoKSxcbiAgICAgICAgICAgIGRlZmF1bHRSZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogZnVuY3Rpb25Db25maWd1cmF0aW9uLlByb3BlcnRpZXM/LlJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlLCAvLyBUaGlzIHNob3VsZCBoYW5kbGUgZXJyb3IgbWVzc2FnZXNcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHsgLy8gU2hvdWxkIGJlIGEgdGFibGUvbW9kZWwgcmVzb2x2ZXIgLT4gTWF5YmUgbm90IHRydWUgd2hlbiB3ZSBhZGQgaW4gQHNlYXJjaGFibGUsIGV0Y1xuICAgICAgICAgIGNvbnN0IGRhdGFTb3VyY2VOYW1lID0gcmVzb3VyY2UuUHJvcGVydGllcz8uRGF0YVNvdXJjZU5hbWU/LnBheWxvYWRbMF07XG4gICAgICAgICAgY29uc3QgZGF0YVNvdXJjZSA9IHRlbXBsYXRlUmVzb3VyY2VzW2RhdGFTb3VyY2VOYW1lXTtcbiAgICAgICAgICBjb25zdCBkYXRhU291cmNlVHlwZSA9IGRhdGFTb3VyY2UuUHJvcGVydGllcz8uVHlwZTtcblxuICAgICAgICAgIGxldCB0eXBlTmFtZSA9IHJlc291cmNlLlByb3BlcnRpZXM/LlR5cGVOYW1lO1xuICAgICAgICAgIGxldCBmaWVsZE5hbWUgPSByZXNvdXJjZS5Qcm9wZXJ0aWVzPy5GaWVsZE5hbWU7XG5cbiAgICAgICAgICBzd2l0Y2ggKGRhdGFTb3VyY2VUeXBlKSB7XG4gICAgICAgICAgICBjYXNlICdBTUFaT05fRFlOQU1PREInOlxuICAgICAgICAgICAgICBsZXQgdGFibGVOYW1lID0gZGF0YVNvdXJjZU5hbWUucmVwbGFjZSgnRGF0YVNvdXJjZScsICdUYWJsZScpO1xuICAgICAgICAgICAgICBpZiAoZ3JhcGhxbFR5cGVTdGF0ZW1lbnRzLmluZGV4T2YodHlwZU5hbWUpID49IDApIHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlc29sdmVyVGFibGVNYXBbZmllbGROYW1lXSA9IHRhYmxlTmFtZTtcbiAgICAgICAgICAgICAgfSBlbHNlIHsgLy8gdGhpcyBpcyBhIEdTSVxuICAgICAgICAgICAgICAgIHRoaXMuZ3NpUmVzb2x2ZXJUYWJsZU1hcFtgJHt0eXBlTmFtZX0ke2ZpZWxkTmFtZX1gXSA9IHRhYmxlTmFtZTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ0hUVFAnOlxuICAgICAgICAgICAgICBjb25zdCBodHRwQ29uZmlnID0gZGF0YVNvdXJjZS5Qcm9wZXJ0aWVzPy5IdHRwQ29uZmlnO1xuICAgICAgICAgICAgICBjb25zdCBlbmRwb2ludCA9IGh0dHBDb25maWcuRW5kcG9pbnQ7XG5cbiAgICAgICAgICAgICAgaWYgKCF0aGlzLmh0dHBSZXNvbHZlcnNbZW5kcG9pbnRdKSB0aGlzLmh0dHBSZXNvbHZlcnNbZW5kcG9pbnRdID0gW107XG4gICAgICAgICAgICAgIHRoaXMuaHR0cFJlc29sdmVyc1tlbmRwb2ludF0ucHVzaCh7XG4gICAgICAgICAgICAgICAgdHlwZU5hbWUsXG4gICAgICAgICAgICAgICAgZmllbGROYW1lLFxuICAgICAgICAgICAgICAgIGh0dHBDb25maWcsXG4gICAgICAgICAgICAgICAgZGVmYXVsdFJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IHJlc291cmNlLlByb3BlcnRpZXM/LlJlcXVlc3RNYXBwaW5nVGVtcGxhdGUsXG4gICAgICAgICAgICAgICAgZGVmYXVsdFJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiByZXNvdXJjZS5Qcm9wZXJ0aWVzPy5SZXNwb25zZU1hcHBpbmdUZW1wbGF0ZSxcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBEYXRhIFNvdXJjZSBUeXBlOiAke2RhdGFTb3VyY2VUeXBlfWApO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYnVpbGRUYWJsZXNGcm9tUmVzb3VyY2UocmVzb3VyY2VOYW1lOiBzdHJpbmcsIGN0eDogVHJhbnNmb3JtZXJDb250ZXh0KTogdm9pZCB7XG4gICAgY29uc3QgdGFibGVSZXNvdXJjZSA9IGN0eC50ZW1wbGF0ZS5SZXNvdXJjZXMgPyBjdHgudGVtcGxhdGUuUmVzb3VyY2VzW3Jlc291cmNlTmFtZV0gOiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCBhdHRyaWJ1dGVEZWZpbml0aW9ucyA9IHRhYmxlUmVzb3VyY2U/LlByb3BlcnRpZXM/LkF0dHJpYnV0ZURlZmluaXRpb25zO1xuICAgIGNvbnN0IGtleVNjaGVtYSA9IHRhYmxlUmVzb3VyY2U/LlByb3BlcnRpZXM/LktleVNjaGVtYTtcblxuICAgIGNvbnN0IGtleXMgPSB0aGlzLnBhcnNlS2V5U2NoZW1hKGtleVNjaGVtYSwgYXR0cmlidXRlRGVmaW5pdGlvbnMpO1xuXG4gICAgbGV0IHR0bCA9IHRhYmxlUmVzb3VyY2U/LlByb3BlcnRpZXM/LlRpbWVUb0xpdmVTcGVjaWZpY2F0aW9uO1xuICAgIGlmICh0dGwpIHtcbiAgICAgIHR0bCA9IHtcbiAgICAgICAgYXR0cmlidXRlTmFtZTogdHRsLkF0dHJpYnV0ZU5hbWUsXG4gICAgICAgIGVuYWJsZWQ6IHR0bC5FbmFibGVkLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBsZXQgdGFibGU6IENka1RyYW5zZm9ybWVyVGFibGUgPSB7XG4gICAgICB0YWJsZU5hbWU6IHJlc291cmNlTmFtZSxcbiAgICAgIHBhcnRpdGlvbktleToga2V5cy5wYXJ0aXRpb25LZXksXG4gICAgICBzb3J0S2V5OiBrZXlzLnNvcnRLZXksXG4gICAgICB0dGw6IHR0bCxcbiAgICAgIGxvY2FsU2Vjb25kYXJ5SW5kZXhlczogW10sXG4gICAgICBnbG9iYWxTZWNvbmRhcnlJbmRleGVzOiBbXSxcbiAgICAgIHJlc29sdmVyczogW10sXG4gICAgICBnc2lSZXNvbHZlcnM6IFtdLFxuICAgIH07XG5cbiAgICBjb25zdCBsc2lzID0gdGFibGVSZXNvdXJjZT8uUHJvcGVydGllcz8uTG9jYWxTZWNvbmRhcnlJbmRleGVzO1xuICAgIGlmIChsc2lzKSB7XG4gICAgICBsc2lzLmZvckVhY2goKGxzaTogYW55KSA9PiB7XG4gICAgICAgIGNvbnN0IGxzaUtleXMgPSB0aGlzLnBhcnNlS2V5U2NoZW1hKGxzaS5LZXlTY2hlbWEsIGF0dHJpYnV0ZURlZmluaXRpb25zKTtcbiAgICAgICAgY29uc3QgbHNpRGVmaW5pdGlvbiA9IHtcbiAgICAgICAgICBpbmRleE5hbWU6IGxzaS5JbmRleE5hbWUsXG4gICAgICAgICAgcHJvamVjdGlvbjogbHNpLlByb2plY3Rpb24sXG4gICAgICAgICAgc29ydEtleTogbHNpS2V5cy5zb3J0S2V5LFxuICAgICAgICB9O1xuXG4gICAgICAgIHRhYmxlLmxvY2FsU2Vjb25kYXJ5SW5kZXhlcy5wdXNoKGxzaURlZmluaXRpb24pO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgZ3NpcyA9IHRhYmxlUmVzb3VyY2U/LlByb3BlcnRpZXM/Lkdsb2JhbFNlY29uZGFyeUluZGV4ZXM7XG4gICAgaWYgKGdzaXMpIHtcbiAgICAgIGdzaXMuZm9yRWFjaCgoZ3NpOiBhbnkpID0+IHtcbiAgICAgICAgY29uc3QgZ3NpS2V5cyA9IHRoaXMucGFyc2VLZXlTY2hlbWEoZ3NpLktleVNjaGVtYSwgYXR0cmlidXRlRGVmaW5pdGlvbnMpO1xuICAgICAgICBjb25zdCBnc2lEZWZpbml0aW9uID0ge1xuICAgICAgICAgIGluZGV4TmFtZTogZ3NpLkluZGV4TmFtZSxcbiAgICAgICAgICBwcm9qZWN0aW9uOiBnc2kuUHJvamVjdGlvbixcbiAgICAgICAgICBwYXJ0aXRpb25LZXk6IGdzaUtleXMucGFydGl0aW9uS2V5LFxuICAgICAgICAgIHNvcnRLZXk6IGdzaUtleXMuc29ydEtleSxcbiAgICAgICAgfTtcblxuICAgICAgICB0YWJsZS5nbG9iYWxTZWNvbmRhcnlJbmRleGVzLnB1c2goZ3NpRGVmaW5pdGlvbik7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICB0aGlzLnRhYmxlc1tyZXNvdXJjZU5hbWVdID0gdGFibGU7XG4gIH1cblxuICBwcml2YXRlIHBhcnNlS2V5U2NoZW1hKGtleVNjaGVtYTogYW55LCBhdHRyaWJ1dGVEZWZpbml0aW9uczogYW55KSB7XG4gICAgbGV0IHBhcnRpdGlvbktleTogYW55ID0ge307XG4gICAgbGV0IHNvcnRLZXk6IGFueSA9IHt9O1xuXG4gICAga2V5U2NoZW1hLmZvckVhY2goKGtleTogYW55KSA9PiB7XG4gICAgICBjb25zdCBrZXlUeXBlID0ga2V5LktleVR5cGU7XG4gICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0ga2V5LkF0dHJpYnV0ZU5hbWU7XG5cbiAgICAgIGNvbnN0IGF0dHJpYnV0ZSA9IGF0dHJpYnV0ZURlZmluaXRpb25zLmZpbmQoKGF0dHI6IGFueSkgPT4gYXR0ci5BdHRyaWJ1dGVOYW1lID09PSBhdHRyaWJ1dGVOYW1lKTtcblxuICAgICAgaWYgKGtleVR5cGUgPT09ICdIQVNIJykge1xuICAgICAgICBwYXJ0aXRpb25LZXkgPSB7XG4gICAgICAgICAgbmFtZTogYXR0cmlidXRlLkF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgdHlwZTogYXR0cmlidXRlLkF0dHJpYnV0ZVR5cGUsXG4gICAgICAgIH07XG4gICAgICB9IGVsc2UgaWYgKGtleVR5cGUgPT09ICdSQU5HRScpIHtcbiAgICAgICAgc29ydEtleSA9IHtcbiAgICAgICAgICBuYW1lOiBhdHRyaWJ1dGUuQXR0cmlidXRlTmFtZSxcbiAgICAgICAgICB0eXBlOiBhdHRyaWJ1dGUuQXR0cmlidXRlVHlwZSxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiB7IHBhcnRpdGlvbktleSwgc29ydEtleSB9O1xuICB9XG59XG4iXX0=