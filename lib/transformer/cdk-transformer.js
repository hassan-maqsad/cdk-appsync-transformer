"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CdkTransformer = void 0;
const aws_appsync_alpha_1 = require("@aws-cdk/aws-appsync-alpha");
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
                        defaultRequestMappingTemplate: aws_appsync_alpha_1.MappingTemplate.lambdaRequest().renderTemplate(),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2RrLXRyYW5zZm9ybWVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3RyYW5zZm9ybWVyL2Nkay10cmFuc2Zvcm1lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxrRUFBNkQ7QUFDN0QsdUVBQThGO0FBRTlGLE1BQU0scUJBQXFCLEdBQUcsQ0FBQyxPQUFPLEVBQUUsVUFBVSxFQUFFLGNBQWMsQ0FBQyxDQUFDO0FBb0RwRSxNQUFhLGNBQWUsU0FBUSxzQ0FBVztJQVE3QztRQUNFLEtBQUssQ0FDSCxnQkFBZ0IsRUFDaEIseUNBQXlDLENBQzFDLENBQUM7UUFVRyxVQUFLLEdBQUcsQ0FBQyxHQUF1QixFQUFRLEVBQUU7WUFDL0MsSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUV6QiwrQkFBK0I7WUFDL0IsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxFQUFFO2dCQUMzQyxJQUFJLEtBQUssR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUNuQyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsRUFBRTtvQkFDeEQsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsWUFBWSxDQUFDLEtBQUssU0FBUzt3QkFBRSxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztnQkFDNUYsQ0FBQyxDQUFDLENBQUM7Z0JBRUgsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLEVBQUU7b0JBQzNELElBQUksSUFBSSxDQUFDLG1CQUFtQixDQUFDLFlBQVksQ0FBQyxLQUFLLFNBQVM7d0JBQUUsS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7Z0JBQ2xHLENBQUMsQ0FBQyxDQUFDO1lBQ0wsQ0FBQyxDQUFDLENBQUM7WUFFSCw2REFBNkQ7WUFDN0QsR0FBRyxDQUFDLFNBQVMsQ0FBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBRXhDLDZEQUE2RDtZQUM3RCxHQUFHLENBQUMsU0FBUyxDQUFDLGVBQWUsRUFBRSxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUM7WUFFckQsNkRBQTZEO1lBQzdELEdBQUcsQ0FBQyxTQUFTLENBQUMsbUJBQW1CLEVBQUUsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUM7WUFFM0QsNkRBQTZEO1lBQzdELEdBQUcsQ0FBQyxTQUFTLENBQUMsZUFBZSxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQztZQUVuRCxNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDN0IsSUFBSSxLQUFLLEVBQUU7Z0JBQ1QsTUFBTSxXQUFXLEdBQUcsNENBQWlCLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQzdDLEdBQUcsQ0FBQyxTQUFTLENBQUMsU0FBUyxFQUFFLFdBQVcsQ0FBQyxDQUFDO2FBQ3ZDO1lBRUQsTUFBTSxRQUFRLEdBQUcsR0FBRyxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ25DLElBQUksUUFBUSxFQUFFO2dCQUNaLE1BQU0sY0FBYyxHQUFHLDRDQUFpQixDQUFDLFFBQVEsQ0FBQyxDQUFDO2dCQUNuRCxHQUFHLENBQUMsU0FBUyxDQUFDLFdBQVcsRUFBRSxjQUFjLENBQUMsQ0FBQzthQUM1QztZQUVELE1BQU0sWUFBWSxHQUFHLEdBQUcsQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUMzQyxJQUFJLFlBQVksRUFBRTtnQkFDaEIsTUFBTSxrQkFBa0IsR0FBRyw0Q0FBaUIsQ0FBQyxZQUFZLENBQUMsQ0FBQztnQkFDM0QsR0FBRyxDQUFDLFNBQVMsQ0FBQyxlQUFlLEVBQUUsa0JBQWtCLENBQUMsQ0FBQzthQUNwRDtRQUNILENBQUMsQ0FBQztRQXBEQSxJQUFJLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQztRQUNqQixJQUFJLENBQUMsZUFBZSxHQUFHLEVBQUUsQ0FBQztRQUMxQixJQUFJLENBQUMsaUJBQWlCLEdBQUcsRUFBRSxDQUFDO1FBQzVCLElBQUksQ0FBQyxhQUFhLEdBQUcsRUFBRSxDQUFDO1FBQ3hCLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxFQUFFLENBQUM7UUFDM0IsSUFBSSxDQUFDLG1CQUFtQixHQUFHLEVBQUUsQ0FBQztJQUNoQyxDQUFDO0lBZ0RPLGNBQWMsQ0FBQyxHQUF1Qjs7UUFDNUMsTUFBTSxpQkFBaUIsR0FBRyxHQUFHLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQztRQUNqRCxJQUFJLENBQUMsaUJBQWlCO1lBQUUsT0FBTztRQUUvQixLQUFLLE1BQU0sQ0FBQyxZQUFZLEVBQUUsUUFBUSxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFO1lBQ3hFLElBQUksUUFBUSxDQUFDLElBQUksS0FBSyxzQkFBc0IsRUFBRTtnQkFDNUMsSUFBSSxDQUFDLHVCQUF1QixDQUFDLFlBQVksRUFBRSxHQUFHLENBQUMsQ0FBQzthQUNqRDtpQkFBTSxJQUFJLFFBQVEsQ0FBQyxJQUFJLEtBQUssd0JBQXdCLEVBQUU7Z0JBQ3JELElBQUksT0FBQSxRQUFRLENBQUMsVUFBVSwwQ0FBRSxjQUFjLE1BQUssTUFBTSxFQUFFO29CQUNsRCxJQUFJLENBQUMsZUFBZSxDQUFDLEdBQUcsUUFBUSxDQUFDLFVBQVUsQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDLFVBQVUsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxHQUFHO3dCQUN4RixRQUFRLEVBQUUsUUFBUSxDQUFDLFVBQVUsQ0FBQyxRQUFRO3dCQUN0QyxTQUFTLEVBQUUsUUFBUSxDQUFDLFVBQVUsQ0FBQyxTQUFTO3FCQUN6QyxDQUFDO2lCQUNIO3FCQUFNLElBQUksT0FBQSxRQUFRLENBQUMsVUFBVSwwQ0FBRSxJQUFJLE1BQUssVUFBVSxFQUFFO29CQUNuRCxlQUFlO29CQUNmLDZJQUE2STtvQkFDN0ksTUFBTSxTQUFTLFNBQUcsUUFBUSxDQUFDLFNBQW1CLG1DQUFJLEVBQUUsQ0FBQztvQkFDckQsTUFBTSxxQkFBcUIsR0FBRyxpQkFBaUIsQ0FBQyxTQUFTLENBQUMsQ0FBQztvQkFDM0QsTUFBTSxpQkFBaUIsU0FBRyxxQkFBcUIsQ0FBQyxTQUFtQixtQ0FBSSxFQUFFLENBQUM7b0JBQzFFLE1BQU0sa0JBQWtCLEdBQUcsaUJBQWlCLENBQUMsaUJBQWlCLENBQUMsQ0FBQztvQkFDaEUsTUFBTSxXQUFXLHFCQUFHLGtCQUFrQixDQUFDLFVBQVUsMENBQUUsWUFBWSwwQ0FBRSxpQkFBaUIsMENBQUUsT0FBTyxDQUFDLENBQUMsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7b0JBQzFHLE1BQU0sWUFBWSxHQUFHLFdBQVcsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7b0JBRXpELE1BQU0sU0FBUyxHQUFHLFFBQVEsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDO29CQUNoRCxNQUFNLFFBQVEsR0FBRyxRQUFRLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQztvQkFFOUMsSUFBSSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxZQUFZLENBQUM7d0JBQUUsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFlBQVksQ0FBQyxHQUFHLEVBQUUsQ0FBQztvQkFFckYsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFlBQVksQ0FBQyxDQUFDLElBQUksQ0FBQzt3QkFDeEMsUUFBUSxFQUFFLFFBQVE7d0JBQ2xCLFNBQVMsRUFBRSxTQUFTO3dCQUNwQiw2QkFBNkIsRUFBRSxtQ0FBZSxDQUFDLGFBQWEsRUFBRSxDQUFDLGNBQWMsRUFBRTt3QkFDL0UsOEJBQThCLFFBQUUscUJBQXFCLENBQUMsVUFBVSwwQ0FBRSx1QkFBdUI7cUJBQzFGLENBQUMsQ0FBQztpQkFDSjtxQkFBTSxFQUFFLHFGQUFxRjtvQkFDNUYsTUFBTSxjQUFjLGVBQUcsUUFBUSxDQUFDLFVBQVUsMENBQUUsY0FBYywwQ0FBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7b0JBQ3ZFLE1BQU0sVUFBVSxHQUFHLGlCQUFpQixDQUFDLGNBQWMsQ0FBQyxDQUFDO29CQUNyRCxNQUFNLGNBQWMsU0FBRyxVQUFVLENBQUMsVUFBVSwwQ0FBRSxJQUFJLENBQUM7b0JBRW5ELElBQUksUUFBUSxTQUFHLFFBQVEsQ0FBQyxVQUFVLDBDQUFFLFFBQVEsQ0FBQztvQkFDN0MsSUFBSSxTQUFTLFNBQUcsUUFBUSxDQUFDLFVBQVUsMENBQUUsU0FBUyxDQUFDO29CQUUvQyxRQUFRLGNBQWMsRUFBRTt3QkFDdEIsS0FBSyxpQkFBaUI7NEJBQ3BCLElBQUksU0FBUyxHQUFHLGNBQWMsQ0FBQyxPQUFPLENBQUMsWUFBWSxFQUFFLE9BQU8sQ0FBQyxDQUFDOzRCQUM5RCxJQUFJLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUU7Z0NBQ2hELElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxTQUFTLENBQUMsR0FBRyxTQUFTLENBQUM7NkJBQzlDO2lDQUFNLEVBQUUsZ0JBQWdCO2dDQUN2QixJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxRQUFRLEdBQUcsU0FBUyxFQUFFLENBQUMsR0FBRyxTQUFTLENBQUM7NkJBQ2pFOzRCQUNELE1BQU07d0JBQ1IsS0FBSyxNQUFNOzRCQUNULE1BQU0sVUFBVSxTQUFHLFVBQVUsQ0FBQyxVQUFVLDBDQUFFLFVBQVUsQ0FBQzs0QkFDckQsTUFBTSxRQUFRLEdBQUcsVUFBVSxDQUFDLFFBQVEsQ0FBQzs0QkFFckMsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDO2dDQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLEdBQUcsRUFBRSxDQUFDOzRCQUNyRSxJQUFJLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDLElBQUksQ0FBQztnQ0FDaEMsUUFBUTtnQ0FDUixTQUFTO2dDQUNULFVBQVU7Z0NBQ1YsNkJBQTZCLFFBQUUsUUFBUSxDQUFDLFVBQVUsMENBQUUsc0JBQXNCO2dDQUMxRSw4QkFBOEIsUUFBRSxRQUFRLENBQUMsVUFBVSwwQ0FBRSx1QkFBdUI7NkJBQzdFLENBQUMsQ0FBQzs0QkFDSCxNQUFNO3dCQUNSOzRCQUNFLE1BQU0sSUFBSSxLQUFLLENBQUMsaUNBQWlDLGNBQWMsRUFBRSxDQUFDLENBQUM7cUJBQ3RFO2lCQUNGO2FBQ0Y7U0FDRjtJQUNILENBQUM7SUFFTyx1QkFBdUIsQ0FBQyxZQUFvQixFQUFFLEdBQXVCOztRQUMzRSxNQUFNLGFBQWEsR0FBRyxHQUFHLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztRQUVoRyxNQUFNLG9CQUFvQixTQUFHLGFBQWEsYUFBYixhQUFhLHVCQUFiLGFBQWEsQ0FBRSxVQUFVLDBDQUFFLG9CQUFvQixDQUFDO1FBQzdFLE1BQU0sU0FBUyxTQUFHLGFBQWEsYUFBYixhQUFhLHVCQUFiLGFBQWEsQ0FBRSxVQUFVLDBDQUFFLFNBQVMsQ0FBQztRQUV2RCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLFNBQVMsRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO1FBRWxFLElBQUksR0FBRyxTQUFHLGFBQWEsYUFBYixhQUFhLHVCQUFiLGFBQWEsQ0FBRSxVQUFVLDBDQUFFLHVCQUF1QixDQUFDO1FBQzdELElBQUksR0FBRyxFQUFFO1lBQ1AsR0FBRyxHQUFHO2dCQUNKLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYTtnQkFDaEMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxPQUFPO2FBQ3JCLENBQUM7U0FDSDtRQUVELElBQUksS0FBSyxHQUF3QjtZQUMvQixTQUFTLEVBQUUsWUFBWTtZQUN2QixZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVk7WUFDL0IsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPO1lBQ3JCLEdBQUcsRUFBRSxHQUFHO1lBQ1IscUJBQXFCLEVBQUUsRUFBRTtZQUN6QixzQkFBc0IsRUFBRSxFQUFFO1lBQzFCLFNBQVMsRUFBRSxFQUFFO1lBQ2IsWUFBWSxFQUFFLEVBQUU7U0FDakIsQ0FBQztRQUVGLE1BQU0sSUFBSSxTQUFHLGFBQWEsYUFBYixhQUFhLHVCQUFiLGFBQWEsQ0FBRSxVQUFVLDBDQUFFLHFCQUFxQixDQUFDO1FBQzlELElBQUksSUFBSSxFQUFFO1lBQ1IsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQVEsRUFBRSxFQUFFO2dCQUN4QixNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztnQkFDekUsTUFBTSxhQUFhLEdBQUc7b0JBQ3BCLFNBQVMsRUFBRSxHQUFHLENBQUMsU0FBUztvQkFDeEIsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVO29CQUMxQixPQUFPLEVBQUUsT0FBTyxDQUFDLE9BQU87aUJBQ3pCLENBQUM7Z0JBRUYsS0FBSyxDQUFDLHFCQUFxQixDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQztZQUNsRCxDQUFDLENBQUMsQ0FBQztTQUNKO1FBRUQsTUFBTSxJQUFJLFNBQUcsYUFBYSxhQUFiLGFBQWEsdUJBQWIsYUFBYSxDQUFFLFVBQVUsMENBQUUsc0JBQXNCLENBQUM7UUFDL0QsSUFBSSxJQUFJLEVBQUU7WUFDUixJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsR0FBUSxFQUFFLEVBQUU7Z0JBQ3hCLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO2dCQUN6RSxNQUFNLGFBQWEsR0FBRztvQkFDcEIsU0FBUyxFQUFFLEdBQUcsQ0FBQyxTQUFTO29CQUN4QixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVU7b0JBQzFCLFlBQVksRUFBRSxPQUFPLENBQUMsWUFBWTtvQkFDbEMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxPQUFPO2lCQUN6QixDQUFDO2dCQUVGLEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUM7WUFDbkQsQ0FBQyxDQUFDLENBQUM7U0FDSjtRQUVELElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLEdBQUcsS0FBSyxDQUFDO0lBQ3BDLENBQUM7SUFFTyxjQUFjLENBQUMsU0FBYyxFQUFFLG9CQUF5QjtRQUM5RCxJQUFJLFlBQVksR0FBUSxFQUFFLENBQUM7UUFDM0IsSUFBSSxPQUFPLEdBQVEsRUFBRSxDQUFDO1FBRXRCLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxHQUFRLEVBQUUsRUFBRTtZQUM3QixNQUFNLE9BQU8sR0FBRyxHQUFHLENBQUMsT0FBTyxDQUFDO1lBQzVCLE1BQU0sYUFBYSxHQUFHLEdBQUcsQ0FBQyxhQUFhLENBQUM7WUFFeEMsTUFBTSxTQUFTLEdBQUcsb0JBQW9CLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBUyxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxLQUFLLGFBQWEsQ0FBQyxDQUFDO1lBRWpHLElBQUksT0FBTyxLQUFLLE1BQU0sRUFBRTtnQkFDdEIsWUFBWSxHQUFHO29CQUNiLElBQUksRUFBRSxTQUFTLENBQUMsYUFBYTtvQkFDN0IsSUFBSSxFQUFFLFNBQVMsQ0FBQyxhQUFhO2lCQUM5QixDQUFDO2FBQ0g7aUJBQU0sSUFBSSxPQUFPLEtBQUssT0FBTyxFQUFFO2dCQUM5QixPQUFPLEdBQUc7b0JBQ1IsSUFBSSxFQUFFLFNBQVMsQ0FBQyxhQUFhO29CQUM3QixJQUFJLEVBQUUsU0FBUyxDQUFDLGFBQWE7aUJBQzlCLENBQUM7YUFDSDtRQUNILENBQUMsQ0FBQyxDQUFDO1FBRUgsT0FBTyxFQUFFLFlBQVksRUFBRSxPQUFPLEVBQUUsQ0FBQztJQUNuQyxDQUFDO0NBQ0Y7QUFoT0Qsd0NBZ09DIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTWFwcGluZ1RlbXBsYXRlIH0gZnJvbSAnQGF3cy1jZGsvYXdzLWFwcHN5bmMtYWxwaGEnO1xuaW1wb3J0IHsgVHJhbnNmb3JtZXIsIFRyYW5zZm9ybWVyQ29udGV4dCwgZ2V0RmllbGRBcmd1bWVudHMgfSBmcm9tICdncmFwaHFsLXRyYW5zZm9ybWVyLWNvcmUnO1xuXG5jb25zdCBncmFwaHFsVHlwZVN0YXRlbWVudHMgPSBbJ1F1ZXJ5JywgJ011dGF0aW9uJywgJ1N1YnNjcmlwdGlvbiddO1xuXG5leHBvcnQgaW50ZXJmYWNlIENka1RyYW5zZm9ybWVyVGFibGVLZXkge1xuICByZWFkb25seSBuYW1lOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHR5cGU6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDZGtUcmFuc2Zvcm1lckxvY2FsU2Vjb25kYXJ5SW5kZXgge1xuICByZWFkb25seSBpbmRleE5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgcHJvamVjdGlvbjogYW55O1xuICByZWFkb25seSBzb3J0S2V5OiBDZGtUcmFuc2Zvcm1lclRhYmxlS2V5O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIENka1RyYW5zZm9ybWVyR2xvYmFsU2Vjb25kYXJ5SW5kZXgge1xuICByZWFkb25seSBpbmRleE5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgcHJvamVjdGlvbjogYW55O1xuICByZWFkb25seSBwYXJ0aXRpb25LZXk6IENka1RyYW5zZm9ybWVyVGFibGVLZXk7XG4gIHJlYWRvbmx5IHNvcnRLZXk6IENka1RyYW5zZm9ybWVyVGFibGVLZXk7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2RrVHJhbnNmb3JtZXJUYWJsZVR0bCB7XG4gIHJlYWRvbmx5IGF0dHJpYnV0ZU5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgZW5hYmxlZDogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDZGtUcmFuc2Zvcm1lclRhYmxlIHtcbiAgcmVhZG9ubHkgdGFibGVOYW1lOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHBhcnRpdGlvbktleTogQ2RrVHJhbnNmb3JtZXJUYWJsZUtleTtcbiAgcmVhZG9ubHkgc29ydEtleT86IENka1RyYW5zZm9ybWVyVGFibGVLZXk7XG4gIHJlYWRvbmx5IHR0bD86IENka1RyYW5zZm9ybWVyVGFibGVUdGw7XG4gIHJlYWRvbmx5IGxvY2FsU2Vjb25kYXJ5SW5kZXhlczogQ2RrVHJhbnNmb3JtZXJMb2NhbFNlY29uZGFyeUluZGV4W107XG4gIHJlYWRvbmx5IGdsb2JhbFNlY29uZGFyeUluZGV4ZXM6IENka1RyYW5zZm9ybWVyR2xvYmFsU2Vjb25kYXJ5SW5kZXhbXTtcbiAgcmVhZG9ubHkgcmVzb2x2ZXJzOiBzdHJpbmdbXTtcbiAgcmVhZG9ubHkgZ3NpUmVzb2x2ZXJzOiBzdHJpbmdbXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDZGtUcmFuc2Zvcm1lclJlc29sdmVyIHtcbiAgcmVhZG9ubHkgdHlwZU5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgZmllbGROYW1lOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2RrVHJhbnNmb3JtZXJIdHRwUmVzb2x2ZXIgZXh0ZW5kcyBDZGtUcmFuc2Zvcm1lclJlc29sdmVyIHtcbiAgcmVhZG9ubHkgaHR0cENvbmZpZzogYW55O1xuICByZWFkb25seSBkZWZhdWx0UmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogc3RyaW5nO1xuICByZWFkb25seSBkZWZhdWx0UmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDZGtUcmFuc2Zvcm1lckZ1bmN0aW9uUmVzb2x2ZXIgZXh0ZW5kcyBDZGtUcmFuc2Zvcm1lclJlc29sdmVyIHtcbiAgcmVhZG9ubHkgZGVmYXVsdFJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IHN0cmluZztcbiAgcmVhZG9ubHkgZGVmYXVsdFJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBDZGtUcmFuc2Zvcm1lciBleHRlbmRzIFRyYW5zZm9ybWVyIHtcbiAgdGFibGVzOiB7IFtuYW1lOiBzdHJpbmddOiBDZGtUcmFuc2Zvcm1lclRhYmxlIH07XG4gIG5vbmVEYXRhU291cmNlczogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJSZXNvbHZlciB9O1xuICBmdW5jdGlvblJlc29sdmVyczogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJGdW5jdGlvblJlc29sdmVyW10gfTtcbiAgaHR0cFJlc29sdmVyczogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJIdHRwUmVzb2x2ZXJbXSB9O1xuICByZXNvbHZlclRhYmxlTWFwOiB7IFtuYW1lOiBzdHJpbmddOiBzdHJpbmcgfTtcbiAgZ3NpUmVzb2x2ZXJUYWJsZU1hcDogeyBbbmFtZTogc3RyaW5nXTogc3RyaW5nIH07XG5cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoXG4gICAgICAnQ2RrVHJhbnNmb3JtZXInLFxuICAgICAgJ2RpcmVjdGl2ZSBAbnVsbGFibGUgb24gRklFTERfREVGSU5JVElPTicsIC8vIHRoaXMgaXMgdW51c2VkXG4gICAgKTtcblxuICAgIHRoaXMudGFibGVzID0ge307XG4gICAgdGhpcy5ub25lRGF0YVNvdXJjZXMgPSB7fTtcbiAgICB0aGlzLmZ1bmN0aW9uUmVzb2x2ZXJzID0ge307XG4gICAgdGhpcy5odHRwUmVzb2x2ZXJzID0ge307XG4gICAgdGhpcy5yZXNvbHZlclRhYmxlTWFwID0ge307XG4gICAgdGhpcy5nc2lSZXNvbHZlclRhYmxlTWFwID0ge307XG4gIH1cblxuICBwdWJsaWMgYWZ0ZXIgPSAoY3R4OiBUcmFuc2Zvcm1lckNvbnRleHQpOiB2b2lkID0+IHtcbiAgICB0aGlzLmJ1aWxkUmVzb3VyY2VzKGN0eCk7XG5cbiAgICAvLyBUT0RPOiBJbXByb3ZlIHRoaXMgaXRlcmF0aW9uXG4gICAgT2JqZWN0LmtleXModGhpcy50YWJsZXMpLmZvckVhY2godGFibGVOYW1lID0+IHtcbiAgICAgIGxldCB0YWJsZSA9IHRoaXMudGFibGVzW3RhYmxlTmFtZV07XG4gICAgICBPYmplY3Qua2V5cyh0aGlzLnJlc29sdmVyVGFibGVNYXApLmZvckVhY2gocmVzb2x2ZXJOYW1lID0+IHtcbiAgICAgICAgaWYgKHRoaXMucmVzb2x2ZXJUYWJsZU1hcFtyZXNvbHZlck5hbWVdID09PSB0YWJsZU5hbWUpIHRhYmxlLnJlc29sdmVycy5wdXNoKHJlc29sdmVyTmFtZSk7XG4gICAgICB9KTtcblxuICAgICAgT2JqZWN0LmtleXModGhpcy5nc2lSZXNvbHZlclRhYmxlTWFwKS5mb3JFYWNoKHJlc29sdmVyTmFtZSA9PiB7XG4gICAgICAgIGlmICh0aGlzLmdzaVJlc29sdmVyVGFibGVNYXBbcmVzb2x2ZXJOYW1lXSA9PT0gdGFibGVOYW1lKSB0YWJsZS5nc2lSZXNvbHZlcnMucHVzaChyZXNvbHZlck5hbWUpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBAdHMtaWdub3JlIC0gd2UgYXJlIG92ZXJsb2FkaW5nIHRoZSB1c2Ugb2Ygb3V0cHV0cyBoZXJlLi4uXG4gICAgY3R4LnNldE91dHB1dCgnY2RrVGFibGVzJywgdGhpcy50YWJsZXMpO1xuXG4gICAgLy8gQHRzLWlnbm9yZSAtIHdlIGFyZSBvdmVybG9hZGluZyB0aGUgdXNlIG9mIG91dHB1dHMgaGVyZS4uLlxuICAgIGN0eC5zZXRPdXRwdXQoJ25vbmVSZXNvbHZlcnMnLCB0aGlzLm5vbmVEYXRhU291cmNlcyk7XG5cbiAgICAvLyBAdHMtaWdub3JlIC0gd2UgYXJlIG92ZXJsb2FkaW5nIHRoZSB1c2Ugb2Ygb3V0cHV0cyBoZXJlLi4uXG4gICAgY3R4LnNldE91dHB1dCgnZnVuY3Rpb25SZXNvbHZlcnMnLCB0aGlzLmZ1bmN0aW9uUmVzb2x2ZXJzKTtcblxuICAgIC8vIEB0cy1pZ25vcmUgLSB3ZSBhcmUgb3ZlcmxvYWRpbmcgdGhlIHVzZSBvZiBvdXRwdXRzIGhlcmUuLi5cbiAgICBjdHguc2V0T3V0cHV0KCdodHRwUmVzb2x2ZXJzJywgdGhpcy5odHRwUmVzb2x2ZXJzKTtcblxuICAgIGNvbnN0IHF1ZXJ5ID0gY3R4LmdldFF1ZXJ5KCk7XG4gICAgaWYgKHF1ZXJ5KSB7XG4gICAgICBjb25zdCBxdWVyeUZpZWxkcyA9IGdldEZpZWxkQXJndW1lbnRzKHF1ZXJ5KTtcbiAgICAgIGN0eC5zZXRPdXRwdXQoJ3F1ZXJpZXMnLCBxdWVyeUZpZWxkcyk7XG4gICAgfVxuXG4gICAgY29uc3QgbXV0YXRpb24gPSBjdHguZ2V0TXV0YXRpb24oKTtcbiAgICBpZiAobXV0YXRpb24pIHtcbiAgICAgIGNvbnN0IG11dGF0aW9uRmllbGRzID0gZ2V0RmllbGRBcmd1bWVudHMobXV0YXRpb24pO1xuICAgICAgY3R4LnNldE91dHB1dCgnbXV0YXRpb25zJywgbXV0YXRpb25GaWVsZHMpO1xuICAgIH1cblxuICAgIGNvbnN0IHN1YnNjcmlwdGlvbiA9IGN0eC5nZXRTdWJzY3JpcHRpb24oKTtcbiAgICBpZiAoc3Vic2NyaXB0aW9uKSB7XG4gICAgICBjb25zdCBzdWJzY3JpcHRpb25GaWVsZHMgPSBnZXRGaWVsZEFyZ3VtZW50cyhzdWJzY3JpcHRpb24pO1xuICAgICAgY3R4LnNldE91dHB1dCgnc3Vic2NyaXB0aW9ucycsIHN1YnNjcmlwdGlvbkZpZWxkcyk7XG4gICAgfVxuICB9O1xuXG4gIHByaXZhdGUgYnVpbGRSZXNvdXJjZXMoY3R4OiBUcmFuc2Zvcm1lckNvbnRleHQpOiB2b2lkIHtcbiAgICBjb25zdCB0ZW1wbGF0ZVJlc291cmNlcyA9IGN0eC50ZW1wbGF0ZS5SZXNvdXJjZXM7XG4gICAgaWYgKCF0ZW1wbGF0ZVJlc291cmNlcykgcmV0dXJuO1xuXG4gICAgZm9yIChjb25zdCBbcmVzb3VyY2VOYW1lLCByZXNvdXJjZV0gb2YgT2JqZWN0LmVudHJpZXModGVtcGxhdGVSZXNvdXJjZXMpKSB7XG4gICAgICBpZiAocmVzb3VyY2UuVHlwZSA9PT0gJ0FXUzo6RHluYW1vREI6OlRhYmxlJykge1xuICAgICAgICB0aGlzLmJ1aWxkVGFibGVzRnJvbVJlc291cmNlKHJlc291cmNlTmFtZSwgY3R4KTtcbiAgICAgIH0gZWxzZSBpZiAocmVzb3VyY2UuVHlwZSA9PT0gJ0FXUzo6QXBwU3luYzo6UmVzb2x2ZXInKSB7XG4gICAgICAgIGlmIChyZXNvdXJjZS5Qcm9wZXJ0aWVzPy5EYXRhU291cmNlTmFtZSA9PT0gJ05PTkUnKSB7XG4gICAgICAgICAgdGhpcy5ub25lRGF0YVNvdXJjZXNbYCR7cmVzb3VyY2UuUHJvcGVydGllcy5UeXBlTmFtZX0ke3Jlc291cmNlLlByb3BlcnRpZXMuRmllbGROYW1lfWBdID0ge1xuICAgICAgICAgICAgdHlwZU5hbWU6IHJlc291cmNlLlByb3BlcnRpZXMuVHlwZU5hbWUsXG4gICAgICAgICAgICBmaWVsZE5hbWU6IHJlc291cmNlLlByb3BlcnRpZXMuRmllbGROYW1lLFxuICAgICAgICAgIH07XG4gICAgICAgIH0gZWxzZSBpZiAocmVzb3VyY2UuUHJvcGVydGllcz8uS2luZCA9PT0gJ1BJUEVMSU5FJykge1xuICAgICAgICAgIC8vIEluc3BpcmVkIGJ5OlxuICAgICAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9hd3MtYW1wbGlmeS9hbXBsaWZ5LWNsaS9ibG9iL21hc3Rlci9wYWNrYWdlcy9ncmFwaHFsLWZ1bmN0aW9uLXRyYW5zZm9ybWVyL3NyYy9fX3Rlc3RzX18vRnVuY3Rpb25UcmFuc2Zvcm1lci50ZXN0LnRzI0wyMFxuICAgICAgICAgIGNvbnN0IGRlcGVuZHNPbiA9IHJlc291cmNlLkRlcGVuZHNPbiBhcyBzdHJpbmcgPz8gJyc7XG4gICAgICAgICAgY29uc3QgZnVuY3Rpb25Db25maWd1cmF0aW9uID0gdGVtcGxhdGVSZXNvdXJjZXNbZGVwZW5kc09uXTtcbiAgICAgICAgICBjb25zdCBmdW5jdGlvbkRlcGVuZHNPbiA9IGZ1bmN0aW9uQ29uZmlndXJhdGlvbi5EZXBlbmRzT24gYXMgc3RyaW5nID8/ICcnO1xuICAgICAgICAgIGNvbnN0IGZ1bmN0aW9uRGF0YVNvdXJjZSA9IHRlbXBsYXRlUmVzb3VyY2VzW2Z1bmN0aW9uRGVwZW5kc09uXTtcbiAgICAgICAgICBjb25zdCBmdW5jdGlvbkFybiA9IGZ1bmN0aW9uRGF0YVNvdXJjZS5Qcm9wZXJ0aWVzPy5MYW1iZGFDb25maWc/LkxhbWJkYUZ1bmN0aW9uQXJuPy5wYXlsb2FkWzFdLnBheWxvYWRbMF07XG4gICAgICAgICAgY29uc3QgZnVuY3Rpb25OYW1lID0gZnVuY3Rpb25Bcm4uc3BsaXQoJzonKS5zbGljZSgtMSlbMF07XG5cbiAgICAgICAgICBjb25zdCBmaWVsZE5hbWUgPSByZXNvdXJjZS5Qcm9wZXJ0aWVzLkZpZWxkTmFtZTtcbiAgICAgICAgICBjb25zdCB0eXBlTmFtZSA9IHJlc291cmNlLlByb3BlcnRpZXMuVHlwZU5hbWU7XG5cbiAgICAgICAgICBpZiAoIXRoaXMuZnVuY3Rpb25SZXNvbHZlcnNbZnVuY3Rpb25OYW1lXSkgdGhpcy5mdW5jdGlvblJlc29sdmVyc1tmdW5jdGlvbk5hbWVdID0gW107XG5cbiAgICAgICAgICB0aGlzLmZ1bmN0aW9uUmVzb2x2ZXJzW2Z1bmN0aW9uTmFtZV0ucHVzaCh7XG4gICAgICAgICAgICB0eXBlTmFtZTogdHlwZU5hbWUsXG4gICAgICAgICAgICBmaWVsZE5hbWU6IGZpZWxkTmFtZSxcbiAgICAgICAgICAgIGRlZmF1bHRSZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBNYXBwaW5nVGVtcGxhdGUubGFtYmRhUmVxdWVzdCgpLnJlbmRlclRlbXBsYXRlKCksXG4gICAgICAgICAgICBkZWZhdWx0UmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGZ1bmN0aW9uQ29uZmlndXJhdGlvbi5Qcm9wZXJ0aWVzPy5SZXNwb25zZU1hcHBpbmdUZW1wbGF0ZSwgLy8gVGhpcyBzaG91bGQgaGFuZGxlIGVycm9yIG1lc3NhZ2VzXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7IC8vIFNob3VsZCBiZSBhIHRhYmxlL21vZGVsIHJlc29sdmVyIC0+IE1heWJlIG5vdCB0cnVlIHdoZW4gd2UgYWRkIGluIEBzZWFyY2hhYmxlLCBldGNcbiAgICAgICAgICBjb25zdCBkYXRhU291cmNlTmFtZSA9IHJlc291cmNlLlByb3BlcnRpZXM/LkRhdGFTb3VyY2VOYW1lPy5wYXlsb2FkWzBdO1xuICAgICAgICAgIGNvbnN0IGRhdGFTb3VyY2UgPSB0ZW1wbGF0ZVJlc291cmNlc1tkYXRhU291cmNlTmFtZV07XG4gICAgICAgICAgY29uc3QgZGF0YVNvdXJjZVR5cGUgPSBkYXRhU291cmNlLlByb3BlcnRpZXM/LlR5cGU7XG5cbiAgICAgICAgICBsZXQgdHlwZU5hbWUgPSByZXNvdXJjZS5Qcm9wZXJ0aWVzPy5UeXBlTmFtZTtcbiAgICAgICAgICBsZXQgZmllbGROYW1lID0gcmVzb3VyY2UuUHJvcGVydGllcz8uRmllbGROYW1lO1xuXG4gICAgICAgICAgc3dpdGNoIChkYXRhU291cmNlVHlwZSkge1xuICAgICAgICAgICAgY2FzZSAnQU1BWk9OX0RZTkFNT0RCJzpcbiAgICAgICAgICAgICAgbGV0IHRhYmxlTmFtZSA9IGRhdGFTb3VyY2VOYW1lLnJlcGxhY2UoJ0RhdGFTb3VyY2UnLCAnVGFibGUnKTtcbiAgICAgICAgICAgICAgaWYgKGdyYXBocWxUeXBlU3RhdGVtZW50cy5pbmRleE9mKHR5cGVOYW1lKSA+PSAwKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5yZXNvbHZlclRhYmxlTWFwW2ZpZWxkTmFtZV0gPSB0YWJsZU5hbWU7XG4gICAgICAgICAgICAgIH0gZWxzZSB7IC8vIHRoaXMgaXMgYSBHU0lcbiAgICAgICAgICAgICAgICB0aGlzLmdzaVJlc29sdmVyVGFibGVNYXBbYCR7dHlwZU5hbWV9JHtmaWVsZE5hbWV9YF0gPSB0YWJsZU5hbWU7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdIVFRQJzpcbiAgICAgICAgICAgICAgY29uc3QgaHR0cENvbmZpZyA9IGRhdGFTb3VyY2UuUHJvcGVydGllcz8uSHR0cENvbmZpZztcbiAgICAgICAgICAgICAgY29uc3QgZW5kcG9pbnQgPSBodHRwQ29uZmlnLkVuZHBvaW50O1xuXG4gICAgICAgICAgICAgIGlmICghdGhpcy5odHRwUmVzb2x2ZXJzW2VuZHBvaW50XSkgdGhpcy5odHRwUmVzb2x2ZXJzW2VuZHBvaW50XSA9IFtdO1xuICAgICAgICAgICAgICB0aGlzLmh0dHBSZXNvbHZlcnNbZW5kcG9pbnRdLnB1c2goe1xuICAgICAgICAgICAgICAgIHR5cGVOYW1lLFxuICAgICAgICAgICAgICAgIGZpZWxkTmFtZSxcbiAgICAgICAgICAgICAgICBodHRwQ29uZmlnLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRSZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiByZXNvdXJjZS5Qcm9wZXJ0aWVzPy5SZXF1ZXN0TWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRSZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogcmVzb3VyY2UuUHJvcGVydGllcz8uUmVzcG9uc2VNYXBwaW5nVGVtcGxhdGUsXG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgRGF0YSBTb3VyY2UgVHlwZTogJHtkYXRhU291cmNlVHlwZX1gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGJ1aWxkVGFibGVzRnJvbVJlc291cmNlKHJlc291cmNlTmFtZTogc3RyaW5nLCBjdHg6IFRyYW5zZm9ybWVyQ29udGV4dCk6IHZvaWQge1xuICAgIGNvbnN0IHRhYmxlUmVzb3VyY2UgPSBjdHgudGVtcGxhdGUuUmVzb3VyY2VzID8gY3R4LnRlbXBsYXRlLlJlc291cmNlc1tyZXNvdXJjZU5hbWVdIDogdW5kZWZpbmVkO1xuXG4gICAgY29uc3QgYXR0cmlidXRlRGVmaW5pdGlvbnMgPSB0YWJsZVJlc291cmNlPy5Qcm9wZXJ0aWVzPy5BdHRyaWJ1dGVEZWZpbml0aW9ucztcbiAgICBjb25zdCBrZXlTY2hlbWEgPSB0YWJsZVJlc291cmNlPy5Qcm9wZXJ0aWVzPy5LZXlTY2hlbWE7XG5cbiAgICBjb25zdCBrZXlzID0gdGhpcy5wYXJzZUtleVNjaGVtYShrZXlTY2hlbWEsIGF0dHJpYnV0ZURlZmluaXRpb25zKTtcblxuICAgIGxldCB0dGwgPSB0YWJsZVJlc291cmNlPy5Qcm9wZXJ0aWVzPy5UaW1lVG9MaXZlU3BlY2lmaWNhdGlvbjtcbiAgICBpZiAodHRsKSB7XG4gICAgICB0dGwgPSB7XG4gICAgICAgIGF0dHJpYnV0ZU5hbWU6IHR0bC5BdHRyaWJ1dGVOYW1lLFxuICAgICAgICBlbmFibGVkOiB0dGwuRW5hYmxlZCxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgbGV0IHRhYmxlOiBDZGtUcmFuc2Zvcm1lclRhYmxlID0ge1xuICAgICAgdGFibGVOYW1lOiByZXNvdXJjZU5hbWUsXG4gICAgICBwYXJ0aXRpb25LZXk6IGtleXMucGFydGl0aW9uS2V5LFxuICAgICAgc29ydEtleToga2V5cy5zb3J0S2V5LFxuICAgICAgdHRsOiB0dGwsXG4gICAgICBsb2NhbFNlY29uZGFyeUluZGV4ZXM6IFtdLFxuICAgICAgZ2xvYmFsU2Vjb25kYXJ5SW5kZXhlczogW10sXG4gICAgICByZXNvbHZlcnM6IFtdLFxuICAgICAgZ3NpUmVzb2x2ZXJzOiBbXSxcbiAgICB9O1xuXG4gICAgY29uc3QgbHNpcyA9IHRhYmxlUmVzb3VyY2U/LlByb3BlcnRpZXM/LkxvY2FsU2Vjb25kYXJ5SW5kZXhlcztcbiAgICBpZiAobHNpcykge1xuICAgICAgbHNpcy5mb3JFYWNoKChsc2k6IGFueSkgPT4ge1xuICAgICAgICBjb25zdCBsc2lLZXlzID0gdGhpcy5wYXJzZUtleVNjaGVtYShsc2kuS2V5U2NoZW1hLCBhdHRyaWJ1dGVEZWZpbml0aW9ucyk7XG4gICAgICAgIGNvbnN0IGxzaURlZmluaXRpb24gPSB7XG4gICAgICAgICAgaW5kZXhOYW1lOiBsc2kuSW5kZXhOYW1lLFxuICAgICAgICAgIHByb2plY3Rpb246IGxzaS5Qcm9qZWN0aW9uLFxuICAgICAgICAgIHNvcnRLZXk6IGxzaUtleXMuc29ydEtleSxcbiAgICAgICAgfTtcblxuICAgICAgICB0YWJsZS5sb2NhbFNlY29uZGFyeUluZGV4ZXMucHVzaChsc2lEZWZpbml0aW9uKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGdzaXMgPSB0YWJsZVJlc291cmNlPy5Qcm9wZXJ0aWVzPy5HbG9iYWxTZWNvbmRhcnlJbmRleGVzO1xuICAgIGlmIChnc2lzKSB7XG4gICAgICBnc2lzLmZvckVhY2goKGdzaTogYW55KSA9PiB7XG4gICAgICAgIGNvbnN0IGdzaUtleXMgPSB0aGlzLnBhcnNlS2V5U2NoZW1hKGdzaS5LZXlTY2hlbWEsIGF0dHJpYnV0ZURlZmluaXRpb25zKTtcbiAgICAgICAgY29uc3QgZ3NpRGVmaW5pdGlvbiA9IHtcbiAgICAgICAgICBpbmRleE5hbWU6IGdzaS5JbmRleE5hbWUsXG4gICAgICAgICAgcHJvamVjdGlvbjogZ3NpLlByb2plY3Rpb24sXG4gICAgICAgICAgcGFydGl0aW9uS2V5OiBnc2lLZXlzLnBhcnRpdGlvbktleSxcbiAgICAgICAgICBzb3J0S2V5OiBnc2lLZXlzLnNvcnRLZXksXG4gICAgICAgIH07XG5cbiAgICAgICAgdGFibGUuZ2xvYmFsU2Vjb25kYXJ5SW5kZXhlcy5wdXNoKGdzaURlZmluaXRpb24pO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdGhpcy50YWJsZXNbcmVzb3VyY2VOYW1lXSA9IHRhYmxlO1xuICB9XG5cbiAgcHJpdmF0ZSBwYXJzZUtleVNjaGVtYShrZXlTY2hlbWE6IGFueSwgYXR0cmlidXRlRGVmaW5pdGlvbnM6IGFueSkge1xuICAgIGxldCBwYXJ0aXRpb25LZXk6IGFueSA9IHt9O1xuICAgIGxldCBzb3J0S2V5OiBhbnkgPSB7fTtcblxuICAgIGtleVNjaGVtYS5mb3JFYWNoKChrZXk6IGFueSkgPT4ge1xuICAgICAgY29uc3Qga2V5VHlwZSA9IGtleS5LZXlUeXBlO1xuICAgICAgY29uc3QgYXR0cmlidXRlTmFtZSA9IGtleS5BdHRyaWJ1dGVOYW1lO1xuXG4gICAgICBjb25zdCBhdHRyaWJ1dGUgPSBhdHRyaWJ1dGVEZWZpbml0aW9ucy5maW5kKChhdHRyOiBhbnkpID0+IGF0dHIuQXR0cmlidXRlTmFtZSA9PT0gYXR0cmlidXRlTmFtZSk7XG5cbiAgICAgIGlmIChrZXlUeXBlID09PSAnSEFTSCcpIHtcbiAgICAgICAgcGFydGl0aW9uS2V5ID0ge1xuICAgICAgICAgIG5hbWU6IGF0dHJpYnV0ZS5BdHRyaWJ1dGVOYW1lLFxuICAgICAgICAgIHR5cGU6IGF0dHJpYnV0ZS5BdHRyaWJ1dGVUeXBlLFxuICAgICAgICB9O1xuICAgICAgfSBlbHNlIGlmIChrZXlUeXBlID09PSAnUkFOR0UnKSB7XG4gICAgICAgIHNvcnRLZXkgPSB7XG4gICAgICAgICAgbmFtZTogYXR0cmlidXRlLkF0dHJpYnV0ZU5hbWUsXG4gICAgICAgICAgdHlwZTogYXR0cmlidXRlLkF0dHJpYnV0ZVR5cGUsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4geyBwYXJ0aXRpb25LZXksIHNvcnRLZXkgfTtcbiAgfVxufVxuIl19