"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransformerFeatureFlagProvider = exports.SchemaTransformer = void 0;
const fs = require("fs");
const path_1 = require("path");
const graphql_auth_transformer_1 = require("graphql-auth-transformer");
const graphql_connection_transformer_1 = require("graphql-connection-transformer");
const graphql_dynamodb_transformer_1 = require("graphql-dynamodb-transformer");
const graphql_http_transformer_1 = require("graphql-http-transformer");
const graphql_key_transformer_1 = require("graphql-key-transformer");
const graphql_transformer_core_1 = require("graphql-transformer-core");
const graphql_ttl_transformer_1 = require("graphql-ttl-transformer");
const graphql_versioned_transformer_1 = require("graphql-versioned-transformer");
const cdk_transformer_1 = require("./cdk-transformer");
const custom_vtl_transformer_1 = require("./custom-vtl-transformer");
// Import this way because FunctionTransformer.d.ts types were throwing an eror. And we didn't write this package so hope for the best :P
// eslint-disable-next-line
const { FunctionTransformer } = require('graphql-function-transformer');
class SchemaTransformer {
    constructor(props) {
        var _a, _b, _c, _d;
        this.schemaPath = (_a = props.schemaPath) !== null && _a !== void 0 ? _a : './schema.graphql';
        this.outputPath = (_b = props.outputPath) !== null && _b !== void 0 ? _b : './appsync';
        this.isSyncEnabled = (_c = props.syncEnabled) !== null && _c !== void 0 ? _c : false;
        this.customVtlTransformerRootDirectory = (_d = props.customVtlTransformerRootDirectory) !== null && _d !== void 0 ? _d : process.cwd();
        this.outputs = {};
        this.resolvers = {};
        // TODO: Make this better?
        this.authTransformerConfig = {
            authConfig: {
                defaultAuthentication: {
                    authenticationType: 'AMAZON_COGNITO_USER_POOLS',
                    userPoolConfig: {
                        userPoolId: '12345xyz',
                    },
                },
                additionalAuthenticationProviders: [
                    {
                        authenticationType: 'API_KEY',
                        apiKeyConfig: {
                            description: 'Testing',
                            apiKeyExpirationDays: 100,
                        },
                    },
                    {
                        authenticationType: 'AWS_IAM',
                    },
                    {
                        authenticationType: 'OPENID_CONNECT',
                        openIDConnectConfig: {
                            name: 'OIDC',
                            issuerUrl: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXX',
                        },
                    },
                ],
            },
        };
    }
    transform(preCdkTransformers = [], postCdkTransformers = []) {
        var _a, _b, _c;
        const transformConfig = this.isSyncEnabled ? this.loadConfigSync() : {};
        const provider = new TransformerFeatureFlagProvider();
        // Note: This is not exact as we are omitting the @searchable transformer as well as some others.
        const transformer = new graphql_transformer_core_1.GraphQLTransform({
            transformConfig: transformConfig,
            featureFlags: provider,
            transformers: [
                new graphql_dynamodb_transformer_1.DynamoDBModelTransformer(),
                new graphql_ttl_transformer_1.default(),
                new graphql_versioned_transformer_1.VersionedModelTransformer(),
                new FunctionTransformer(),
                new graphql_key_transformer_1.KeyTransformer(),
                new graphql_connection_transformer_1.ModelConnectionTransformer(),
                new graphql_auth_transformer_1.ModelAuthTransformer(this.authTransformerConfig),
                new graphql_http_transformer_1.HttpTransformer(),
                new custom_vtl_transformer_1.CustomVTLTransformer(this.customVtlTransformerRootDirectory),
                ...preCdkTransformers,
                new cdk_transformer_1.CdkTransformer(),
                ...postCdkTransformers,
            ],
        });
        const schema = fs.readFileSync(this.schemaPath);
        const cfdoc = transformer.transform(schema.toString());
        // TODO: Get Unauth Role and Auth Role policies for authorization stuff
        this.unauthRolePolicy = ((_a = cfdoc.rootStack.Resources) === null || _a === void 0 ? void 0 : _a.UnauthRolePolicy01) || undefined;
        this.authRolePolicy = ((_b = cfdoc.rootStack.Resources) === null || _b === void 0 ? void 0 : _b.AuthRolePolicy01) || undefined;
        this.writeSchema(cfdoc.schema);
        this.writeResolversToFile(cfdoc.resolvers);
        // Outputs shouldn't be null but default to empty map
        this.outputs = (_c = cfdoc.rootStack.Outputs) !== null && _c !== void 0 ? _c : {};
        return this.outputs;
    }
    /**
     * Gets the resolvers from the `./appsync/resolvers` folder
     * @returns all resolvers
     */
    getResolvers() {
        const statements = ['Query', 'Mutation'];
        const resolversDirPath = path_1.normalize('./appsync/resolvers');
        if (fs.existsSync(resolversDirPath)) {
            const files = fs.readdirSync(resolversDirPath);
            files.forEach(file => {
                // Example: Mutation.createChannel.response
                let args = file.split('.');
                let typeName = args[0];
                let fieldName = args[1];
                let templateType = args[2]; // request or response
                // default to composite key of typeName and fieldName, however if it
                // is Query, Mutation or Subscription (top level) the compositeKey is the
                // same as fieldName only
                let compositeKey = `${typeName}${fieldName}`;
                if (statements.indexOf(typeName) >= 0) {
                    if (!this.outputs.noneResolvers || !this.outputs.noneResolvers[compositeKey])
                        compositeKey = fieldName;
                }
                let filepath = path_1.normalize(`${resolversDirPath}/${file}`);
                if (statements.indexOf(typeName) >= 0 || (this.outputs.noneResolvers && this.outputs.noneResolvers[compositeKey])) {
                    if (!this.resolvers[compositeKey]) {
                        this.resolvers[compositeKey] = {
                            typeName: typeName,
                            fieldName: fieldName,
                        };
                    }
                    if (templateType === 'req') {
                        this.resolvers[compositeKey].requestMappingTemplate = filepath;
                    }
                    else if (templateType === 'res') {
                        this.resolvers[compositeKey].responseMappingTemplate = filepath;
                    }
                }
                else if (this.isHttpResolver(typeName, fieldName)) {
                    if (!this.resolvers[compositeKey]) {
                        this.resolvers[compositeKey] = {
                            typeName: typeName,
                            fieldName: fieldName,
                        };
                    }
                    if (templateType === 'req') {
                        this.resolvers[compositeKey].requestMappingTemplate = filepath;
                    }
                    else if (templateType === 'res') {
                        this.resolvers[compositeKey].responseMappingTemplate = filepath;
                    }
                }
                else { // This is a GSI
                    if (!this.resolvers.gsi) {
                        this.resolvers.gsi = {};
                    }
                    if (!this.resolvers.gsi[compositeKey]) {
                        this.resolvers.gsi[compositeKey] = {
                            typeName: typeName,
                            fieldName: fieldName,
                            tableName: fieldName.charAt(0).toUpperCase() + fieldName.slice(1),
                        };
                    }
                    if (templateType === 'req') {
                        this.resolvers.gsi[compositeKey].requestMappingTemplate = filepath;
                    }
                    else if (templateType === 'res') {
                        this.resolvers.gsi[compositeKey].responseMappingTemplate = filepath;
                    }
                }
            });
        }
        return this.resolvers;
    }
    /**
     * decides if this is a resolver for an HTTP datasource
     * @param typeName
     * @param fieldName
     */
    isHttpResolver(typeName, fieldName) {
        if (!this.outputs.httpResolvers)
            return false;
        for (const endpoint in this.outputs.httpResolvers) {
            for (const resolver of this.outputs.httpResolvers[endpoint]) {
                if (resolver.typeName === typeName && resolver.fieldName === fieldName)
                    return true;
            }
        }
        return false;
    }
    /**
       * Writes the schema to the output directory for use with @aws-cdk/aws-appsync
       * @param schema
       */
    writeSchema(schema) {
        if (!fs.existsSync(this.outputPath)) {
            fs.mkdirSync(this.outputPath);
        }
        fs.writeFileSync(`${this.outputPath}/schema.graphql`, schema);
    }
    /**
       * Writes all the resolvers to the output directory for loading into the datasources later
       * @param resolvers
       */
    writeResolversToFile(resolvers) {
        if (!fs.existsSync(this.outputPath)) {
            fs.mkdirSync(this.outputPath);
        }
        const resolverFolderPath = path_1.normalize(this.outputPath + '/resolvers');
        if (fs.existsSync(resolverFolderPath)) {
            const files = fs.readdirSync(resolverFolderPath);
            files.forEach(file => fs.unlinkSync(resolverFolderPath + '/' + file));
            fs.rmdirSync(resolverFolderPath);
        }
        if (!fs.existsSync(resolverFolderPath)) {
            fs.mkdirSync(resolverFolderPath);
        }
        Object.keys(resolvers).forEach((key) => {
            const resolver = resolvers[key];
            const fileName = key.replace('.vtl', '');
            const resolverFilePath = path_1.normalize(`${resolverFolderPath}/${fileName}`);
            fs.writeFileSync(resolverFilePath, resolver);
        });
    }
    /**
       * @returns {@link TransformConfig}
      */
    loadConfigSync(projectDir = 'resources') {
        // Initialize the config always with the latest version, other members are optional for now.
        let config = {
            Version: graphql_transformer_core_1.TRANSFORM_CURRENT_VERSION,
            ResolverConfig: {
                project: {
                    ConflictHandler: "OPTIMISTIC_CONCURRENCY" /* OPTIMISTIC */,
                    ConflictDetection: 'VERSION',
                },
            },
        };
        const configDir = path_1.join(__dirname, '..', '..', projectDir);
        try {
            const configPath = path_1.join(configDir, graphql_transformer_core_1.TRANSFORM_CONFIG_FILE_NAME);
            const configExists = fs.existsSync(configPath);
            if (configExists) {
                const configStr = fs.readFileSync(configPath);
                config = JSON.parse(configStr.toString());
            }
            return config;
        }
        catch (err) {
            return config;
        }
    }
}
exports.SchemaTransformer = SchemaTransformer;
/**
 * Grabbed from Amplify
 * https://github.com/aws-amplify/amplify-cli/blob/eb9257eaee117d0ed53ebc23aa28ecd7b7510fa1/packages/graphql-transformer-core/src/FeatureFlags.ts
 */
class TransformerFeatureFlagProvider {
    getBoolean(featureName, options) {
        switch (featureName) {
            case 'improvePluralization':
                return true;
            case 'validateTypeNameReservedWords':
                return false;
            default:
                return this.getValue(featureName, options);
        }
    }
    getString(featureName, options) {
        return this.getValue(featureName, options);
    }
    getNumber(featureName, options) {
        return this.getValue(featureName, options);
    }
    getObject() {
        // Todo: for future extensibility
        throw new Error('Not implemented');
    }
    getValue(featureName, defaultValue) {
        if (defaultValue !== undefined) {
            return defaultValue;
        }
        throw new Error(`No value found for feature ${featureName}`);
    }
}
exports.TransformerFeatureFlagProvider = TransformerFeatureFlagProvider;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hLXRyYW5zZm9ybWVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3RyYW5zZm9ybWVyL3NjaGVtYS10cmFuc2Zvcm1lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSx5QkFBeUI7QUFDekIsK0JBQXVDO0FBQ3ZDLHVFQUE0RjtBQUM1RixtRkFBNEU7QUFDNUUsK0VBQXdFO0FBQ3hFLHVFQUEyRDtBQUMzRCxxRUFBeUQ7QUFDekQsdUVBUWtDO0FBQ2xDLHFFQUFxRDtBQUNyRCxpRkFBMEU7QUFFMUUsdURBTTJCO0FBQzNCLHFFQUFnRTtBQUtoRSx5SUFBeUk7QUFDekksMkJBQTJCO0FBQzNCLE1BQU0sRUFBRSxtQkFBbUIsRUFBRSxHQUFHLE9BQU8sQ0FBQyw4QkFBOEIsQ0FBQyxDQUFDO0FBNEN4RSxNQUFhLGlCQUFpQjtJQWE1QixZQUFZLEtBQTZCOztRQUN2QyxJQUFJLENBQUMsVUFBVSxTQUFHLEtBQUssQ0FBQyxVQUFVLG1DQUFJLGtCQUFrQixDQUFDO1FBQ3pELElBQUksQ0FBQyxVQUFVLFNBQUcsS0FBSyxDQUFDLFVBQVUsbUNBQUksV0FBVyxDQUFDO1FBQ2xELElBQUksQ0FBQyxhQUFhLFNBQUcsS0FBSyxDQUFDLFdBQVcsbUNBQUksS0FBSyxDQUFDO1FBQ2hELElBQUksQ0FBQyxpQ0FBaUMsU0FBRyxLQUFLLENBQUMsaUNBQWlDLG1DQUFJLE9BQU8sQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUVsRyxJQUFJLENBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztRQUNsQixJQUFJLENBQUMsU0FBUyxHQUFHLEVBQUUsQ0FBQztRQUVwQiwwQkFBMEI7UUFDMUIsSUFBSSxDQUFDLHFCQUFxQixHQUFHO1lBQzNCLFVBQVUsRUFBRTtnQkFDVixxQkFBcUIsRUFBRTtvQkFDckIsa0JBQWtCLEVBQUUsMkJBQTJCO29CQUMvQyxjQUFjLEVBQUU7d0JBQ2QsVUFBVSxFQUFFLFVBQVU7cUJBQ3ZCO2lCQUNGO2dCQUNELGlDQUFpQyxFQUFFO29CQUNqQzt3QkFDRSxrQkFBa0IsRUFBRSxTQUFTO3dCQUM3QixZQUFZLEVBQUU7NEJBQ1osV0FBVyxFQUFFLFNBQVM7NEJBQ3RCLG9CQUFvQixFQUFFLEdBQUc7eUJBQzFCO3FCQUNGO29CQUNEO3dCQUNFLGtCQUFrQixFQUFFLFNBQVM7cUJBQzlCO29CQUNEO3dCQUNFLGtCQUFrQixFQUFFLGdCQUFnQjt3QkFDcEMsbUJBQW1CLEVBQUU7NEJBQ25CLElBQUksRUFBRSxNQUFNOzRCQUNaLFNBQVMsRUFBRSwyREFBMkQ7eUJBQ3ZFO3FCQUNGO2lCQUNGO2FBQ0Y7U0FDRixDQUFDO0lBQ0osQ0FBQztJQUVNLFNBQVMsQ0FBQyxxQkFBcUMsRUFBRSxFQUFFLHNCQUFzQyxFQUFFOztRQUNoRyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUV4RSxNQUFNLFFBQVEsR0FBRyxJQUFJLDhCQUE4QixFQUFFLENBQUM7UUFFdEQsaUdBQWlHO1FBQ2pHLE1BQU0sV0FBVyxHQUFHLElBQUksMkNBQWdCLENBQUM7WUFDdkMsZUFBZSxFQUFFLGVBQWU7WUFDaEMsWUFBWSxFQUFFLFFBQVE7WUFDdEIsWUFBWSxFQUFFO2dCQUNaLElBQUksdURBQXdCLEVBQUU7Z0JBQzlCLElBQUksaUNBQWMsRUFBRTtnQkFDcEIsSUFBSSx5REFBeUIsRUFBRTtnQkFDL0IsSUFBSSxtQkFBbUIsRUFBRTtnQkFDekIsSUFBSSx3Q0FBYyxFQUFFO2dCQUNwQixJQUFJLDJEQUEwQixFQUFFO2dCQUNoQyxJQUFJLCtDQUFvQixDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQztnQkFDcEQsSUFBSSwwQ0FBZSxFQUFFO2dCQUNyQixJQUFJLDZDQUFvQixDQUFDLElBQUksQ0FBQyxpQ0FBaUMsQ0FBQztnQkFDaEUsR0FBRyxrQkFBa0I7Z0JBQ3JCLElBQUksZ0NBQWMsRUFBRTtnQkFDcEIsR0FBRyxtQkFBbUI7YUFDdkI7U0FDRixDQUFDLENBQUM7UUFFSCxNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUNoRCxNQUFNLEtBQUssR0FBRyxXQUFXLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDO1FBRXZELHVFQUF1RTtRQUN2RSxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQSxNQUFBLEtBQUssQ0FBQyxTQUFTLENBQUMsU0FBUywwQ0FBRSxrQkFBOEIsS0FBSSxTQUFTLENBQUM7UUFDL0YsSUFBSSxDQUFDLGNBQWMsR0FBRyxDQUFBLE1BQUEsS0FBSyxDQUFDLFNBQVMsQ0FBQyxTQUFTLDBDQUFFLGdCQUE0QixLQUFJLFNBQVMsQ0FBQztRQUUzRixJQUFJLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUMvQixJQUFJLENBQUMsb0JBQW9CLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBRTNDLHFEQUFxRDtRQUNyRCxJQUFJLENBQUMsT0FBTyxTQUFHLEtBQUssQ0FBQyxTQUFTLENBQUMsT0FBTyxtQ0FBSSxFQUFFLENBQUM7UUFFN0MsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDO0lBQ3RCLENBQUM7SUFFRDs7O09BR0c7SUFDSSxZQUFZO1FBQ2pCLE1BQU0sVUFBVSxHQUFHLENBQUMsT0FBTyxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBQ3pDLE1BQU0sZ0JBQWdCLEdBQUcsZ0JBQVMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO1FBQzFELElBQUksRUFBRSxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFO1lBQ25DLE1BQU0sS0FBSyxHQUFHLEVBQUUsQ0FBQyxXQUFXLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztZQUMvQyxLQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFO2dCQUNuQiwyQ0FBMkM7Z0JBQzNDLElBQUksSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7Z0JBQzNCLElBQUksUUFBUSxHQUFXLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDL0IsSUFBSSxTQUFTLEdBQVcsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNoQyxJQUFJLFlBQVksR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxzQkFBc0I7Z0JBRWxELG9FQUFvRTtnQkFDcEUseUVBQXlFO2dCQUN6RSx5QkFBeUI7Z0JBQ3pCLElBQUksWUFBWSxHQUFHLEdBQUcsUUFBUSxHQUFHLFNBQVMsRUFBRSxDQUFDO2dCQUM3QyxJQUFJLFVBQVUsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFO29CQUNyQyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxZQUFZLENBQUM7d0JBQUUsWUFBWSxHQUFHLFNBQVMsQ0FBQztpQkFDeEc7Z0JBRUQsSUFBSSxRQUFRLEdBQUcsZ0JBQVMsQ0FBQyxHQUFHLGdCQUFnQixJQUFJLElBQUksRUFBRSxDQUFDLENBQUM7Z0JBRXhELElBQUksVUFBVSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLGFBQWEsSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxZQUFZLENBQUMsQ0FBQyxFQUFFO29CQUNqSCxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsRUFBRTt3QkFDakMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsR0FBRzs0QkFDN0IsUUFBUSxFQUFFLFFBQVE7NEJBQ2xCLFNBQVMsRUFBRSxTQUFTO3lCQUNyQixDQUFDO3FCQUNIO29CQUVELElBQUksWUFBWSxLQUFLLEtBQUssRUFBRTt3QkFDMUIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxzQkFBc0IsR0FBRyxRQUFRLENBQUM7cUJBQ2hFO3lCQUFNLElBQUksWUFBWSxLQUFLLEtBQUssRUFBRTt3QkFDakMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsQ0FBQyx1QkFBdUIsR0FBRyxRQUFRLENBQUM7cUJBQ2pFO2lCQUNGO3FCQUFNLElBQUksSUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLEVBQUUsU0FBUyxDQUFDLEVBQUU7b0JBQ25ELElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxFQUFFO3dCQUNqQyxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxHQUFHOzRCQUM3QixRQUFRLEVBQUUsUUFBUTs0QkFDbEIsU0FBUyxFQUFFLFNBQVM7eUJBQ3JCLENBQUM7cUJBQ0g7b0JBRUQsSUFBSSxZQUFZLEtBQUssS0FBSyxFQUFFO3dCQUMxQixJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxDQUFDLHNCQUFzQixHQUFHLFFBQVEsQ0FBQztxQkFDaEU7eUJBQU0sSUFBSSxZQUFZLEtBQUssS0FBSyxFQUFFO3dCQUNqQyxJQUFJLENBQUMsU0FBUyxDQUFDLFlBQVksQ0FBQyxDQUFDLHVCQUF1QixHQUFHLFFBQVEsQ0FBQztxQkFDakU7aUJBQ0Y7cUJBQU0sRUFBRSxnQkFBZ0I7b0JBQ3ZCLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsRUFBRTt3QkFDdkIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDO3FCQUN6QjtvQkFDRCxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLEVBQUU7d0JBQ3JDLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxHQUFHOzRCQUNqQyxRQUFRLEVBQUUsUUFBUTs0QkFDbEIsU0FBUyxFQUFFLFNBQVM7NEJBQ3BCLFNBQVMsRUFBRSxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxHQUFHLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO3lCQUNsRSxDQUFDO3FCQUNIO29CQUVELElBQUksWUFBWSxLQUFLLEtBQUssRUFBRTt3QkFDMUIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUMsc0JBQXNCLEdBQUcsUUFBUSxDQUFDO3FCQUNwRTt5QkFBTSxJQUFJLFlBQVksS0FBSyxLQUFLLEVBQUU7d0JBQ2pDLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxDQUFDLHVCQUF1QixHQUFHLFFBQVEsQ0FBQztxQkFDckU7aUJBQ0Y7WUFDSCxDQUFDLENBQUMsQ0FBQztTQUNKO1FBRUQsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDO0lBQ3hCLENBQUM7SUFFRDs7OztPQUlHO0lBRUssY0FBYyxDQUFDLFFBQWdCLEVBQUUsU0FBaUI7UUFDeEQsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsYUFBYTtZQUFFLE9BQU8sS0FBSyxDQUFDO1FBRTlDLEtBQUssTUFBTSxRQUFRLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLEVBQUU7WUFDakQsS0FBSyxNQUFNLFFBQVEsSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsRUFBRTtnQkFDM0QsSUFBSSxRQUFRLENBQUMsUUFBUSxLQUFLLFFBQVEsSUFBSSxRQUFRLENBQUMsU0FBUyxLQUFLLFNBQVM7b0JBQUUsT0FBTyxJQUFJLENBQUM7YUFDckY7U0FDRjtRQUVELE9BQU8sS0FBSyxDQUFDO0lBQ2YsQ0FBQztJQUVEOzs7U0FHSztJQUNHLFdBQVcsQ0FBQyxNQUFXO1FBQzdCLElBQUksQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsRUFBRTtZQUNuQyxFQUFFLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztTQUMvQjtRQUVELEVBQUUsQ0FBQyxhQUFhLENBQUMsR0FBRyxJQUFJLENBQUMsVUFBVSxpQkFBaUIsRUFBRSxNQUFNLENBQUMsQ0FBQztJQUNoRSxDQUFDO0lBRUQ7OztTQUdLO0lBQ0csb0JBQW9CLENBQUMsU0FBYztRQUN6QyxJQUFJLENBQUMsRUFBRSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUU7WUFDbkMsRUFBRSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7U0FDL0I7UUFFRCxNQUFNLGtCQUFrQixHQUFHLGdCQUFTLENBQUMsSUFBSSxDQUFDLFVBQVUsR0FBRyxZQUFZLENBQUMsQ0FBQztRQUNyRSxJQUFJLEVBQUUsQ0FBQyxVQUFVLENBQUMsa0JBQWtCLENBQUMsRUFBRTtZQUNyQyxNQUFNLEtBQUssR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLGtCQUFrQixDQUFDLENBQUM7WUFDakQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsa0JBQWtCLEdBQUcsR0FBRyxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUM7WUFDdEUsRUFBRSxDQUFDLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1NBQ2xDO1FBRUQsSUFBSSxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsa0JBQWtCLENBQUMsRUFBRTtZQUN0QyxFQUFFLENBQUMsU0FBUyxDQUFDLGtCQUFrQixDQUFDLENBQUM7U0FDbEM7UUFFRCxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQVEsRUFBRSxFQUFFO1lBQzFDLE1BQU0sUUFBUSxHQUFHLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNoQyxNQUFNLFFBQVEsR0FBRyxHQUFHLENBQUMsT0FBTyxDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsQ0FBQztZQUN6QyxNQUFNLGdCQUFnQixHQUFHLGdCQUFTLENBQUMsR0FBRyxrQkFBa0IsSUFBSSxRQUFRLEVBQUUsQ0FBQyxDQUFDO1lBQ3hFLEVBQUUsQ0FBQyxhQUFhLENBQUMsZ0JBQWdCLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFDL0MsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQ7O1FBRUk7SUFDSSxjQUFjLENBQUMsYUFBcUIsV0FBVztRQUNyRCw0RkFBNEY7UUFDNUYsSUFBSSxNQUFNLEdBQW9CO1lBQzVCLE9BQU8sRUFBRSxvREFBeUI7WUFDbEMsY0FBYyxFQUFFO2dCQUNkLE9BQU8sRUFBRTtvQkFDUCxlQUFlLDJDQUFnQztvQkFDL0MsaUJBQWlCLEVBQUUsU0FBUztpQkFDN0I7YUFDRjtTQUNGLENBQUM7UUFFRixNQUFNLFNBQVMsR0FBRyxXQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFFMUQsSUFBSTtZQUNGLE1BQU0sVUFBVSxHQUFHLFdBQUksQ0FBQyxTQUFTLEVBQUUscURBQTBCLENBQUMsQ0FBQztZQUMvRCxNQUFNLFlBQVksR0FBRyxFQUFFLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1lBQy9DLElBQUksWUFBWSxFQUFFO2dCQUNoQixNQUFNLFNBQVMsR0FBRyxFQUFFLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBQyxDQUFDO2dCQUM5QyxNQUFNLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQzthQUMzQztZQUVELE9BQU8sTUFBeUIsQ0FBQztTQUNsQztRQUFDLE9BQU8sR0FBRyxFQUFFO1lBQ1osT0FBTyxNQUFNLENBQUM7U0FDZjtJQUNILENBQUM7Q0FDRjtBQW5RRCw4Q0FtUUM7QUFHRDs7O0dBR0c7QUFDSCxNQUFhLDhCQUE4QjtJQUN6QyxVQUFVLENBQUMsV0FBbUIsRUFBRSxPQUFpQjtRQUMvQyxRQUFRLFdBQVcsRUFBRTtZQUNuQixLQUFLLHNCQUFzQjtnQkFDekIsT0FBTyxJQUFJLENBQUM7WUFDZCxLQUFLLCtCQUErQjtnQkFDbEMsT0FBTyxLQUFLLENBQUM7WUFDZjtnQkFDRSxPQUFPLElBQUksQ0FBQyxRQUFRLENBQVUsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1NBQ3ZEO0lBQ0gsQ0FBQztJQUNELFNBQVMsQ0FBQyxXQUFtQixFQUFFLE9BQWdCO1FBQzdDLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBUyxXQUFXLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDckQsQ0FBQztJQUNELFNBQVMsQ0FBQyxXQUFtQixFQUFFLE9BQWdCO1FBQzdDLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBUyxXQUFXLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDckQsQ0FBQztJQUNELFNBQVM7UUFDUCxpQ0FBaUM7UUFDakMsTUFBTSxJQUFJLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0lBQ3JDLENBQUM7SUFFUyxRQUFRLENBQXNDLFdBQW1CLEVBQUUsWUFBZ0I7UUFDM0YsSUFBSSxZQUFZLEtBQUssU0FBUyxFQUFFO1lBQzlCLE9BQU8sWUFBWSxDQUFDO1NBQ3JCO1FBQ0QsTUFBTSxJQUFJLEtBQUssQ0FBQyw4QkFBOEIsV0FBVyxFQUFFLENBQUMsQ0FBQztJQUMvRCxDQUFDO0NBQ0Y7QUE1QkQsd0VBNEJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IHsgbm9ybWFsaXplLCBqb2luIH0gZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBNb2RlbEF1dGhUcmFuc2Zvcm1lciwgTW9kZWxBdXRoVHJhbnNmb3JtZXJDb25maWcgfSBmcm9tICdncmFwaHFsLWF1dGgtdHJhbnNmb3JtZXInO1xuaW1wb3J0IHsgTW9kZWxDb25uZWN0aW9uVHJhbnNmb3JtZXIgfSBmcm9tICdncmFwaHFsLWNvbm5lY3Rpb24tdHJhbnNmb3JtZXInO1xuaW1wb3J0IHsgRHluYW1vREJNb2RlbFRyYW5zZm9ybWVyIH0gZnJvbSAnZ3JhcGhxbC1keW5hbW9kYi10cmFuc2Zvcm1lcic7XG5pbXBvcnQgeyBIdHRwVHJhbnNmb3JtZXIgfSBmcm9tICdncmFwaHFsLWh0dHAtdHJhbnNmb3JtZXInO1xuaW1wb3J0IHsgS2V5VHJhbnNmb3JtZXIgfSBmcm9tICdncmFwaHFsLWtleS10cmFuc2Zvcm1lcic7XG5pbXBvcnQge1xuICBHcmFwaFFMVHJhbnNmb3JtLFxuICBUcmFuc2Zvcm1Db25maWcsXG4gIFRSQU5TRk9STV9DVVJSRU5UX1ZFUlNJT04sXG4gIFRSQU5TRk9STV9DT05GSUdfRklMRV9OQU1FLFxuICBDb25mbGljdEhhbmRsZXJUeXBlLFxuICBJVHJhbnNmb3JtZXIsXG4gIEZlYXR1cmVGbGFnUHJvdmlkZXIsXG59IGZyb20gJ2dyYXBocWwtdHJhbnNmb3JtZXItY29yZSc7XG5pbXBvcnQgVHRsVHJhbnNmb3JtZXIgZnJvbSAnZ3JhcGhxbC10dGwtdHJhbnNmb3JtZXInO1xuaW1wb3J0IHsgVmVyc2lvbmVkTW9kZWxUcmFuc2Zvcm1lciB9IGZyb20gJ2dyYXBocWwtdmVyc2lvbmVkLXRyYW5zZm9ybWVyJztcblxuaW1wb3J0IHtcbiAgQ2RrVHJhbnNmb3JtZXIsXG4gIENka1RyYW5zZm9ybWVyVGFibGUsXG4gIENka1RyYW5zZm9ybWVyUmVzb2x2ZXIsXG4gIENka1RyYW5zZm9ybWVyRnVuY3Rpb25SZXNvbHZlcixcbiAgQ2RrVHJhbnNmb3JtZXJIdHRwUmVzb2x2ZXIsXG59IGZyb20gJy4vY2RrLXRyYW5zZm9ybWVyJztcbmltcG9ydCB7IEN1c3RvbVZUTFRyYW5zZm9ybWVyIH0gZnJvbSAnLi9jdXN0b20tdnRsLXRyYW5zZm9ybWVyJztcblxuLy8gUmVidWlsdCB0aGlzIGZyb20gY2xvdWRmb3JtLXR5cGVzIGJlY2F1c2UgaXQgaGFzIHR5cGUgZXJyb3JzXG5pbXBvcnQgeyBSZXNvdXJjZSB9IGZyb20gJy4vcmVzb3VyY2UnO1xuXG4vLyBJbXBvcnQgdGhpcyB3YXkgYmVjYXVzZSBGdW5jdGlvblRyYW5zZm9ybWVyLmQudHMgdHlwZXMgd2VyZSB0aHJvd2luZyBhbiBlcm9yLiBBbmQgd2UgZGlkbid0IHdyaXRlIHRoaXMgcGFja2FnZSBzbyBob3BlIGZvciB0aGUgYmVzdCA6UFxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lXG5jb25zdCB7IEZ1bmN0aW9uVHJhbnNmb3JtZXIgfSA9IHJlcXVpcmUoJ2dyYXBocWwtZnVuY3Rpb24tdHJhbnNmb3JtZXInKTtcblxuZXhwb3J0IGludGVyZmFjZSBTY2hlbWFUcmFuc2Zvcm1lclByb3BzIHtcbiAgLyoqXG4gICAqIEZpbGUgcGF0aCB0byB0aGUgZ3JhcGhxbCBzY2hlbWFcbiAgICogQGRlZmF1bHQgc2NoZW1hLmdyYXBocWxcbiAgICovXG4gIHJlYWRvbmx5IHNjaGVtYVBhdGg/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFBhdGggd2hlcmUgdHJhbnNmb3JtZWQgc2NoZW1hIGFuZCByZXNvbHZlcnMgd2lsbCBiZSBwbGFjZWRcbiAgICogQGRlZmF1bHQgYXBwc3luY1xuICAgKi9cbiAgcmVhZG9ubHkgb3V0cHV0UGF0aD86IHN0cmluZztcblxuICAvKipcbiAgICogU2V0IGRlbGV0aW9uIHByb3RlY3Rpb24gb24gRHluYW1vREIgdGFibGVzXG4gICAqIEBkZWZhdWx0IHRydWVcbiAgICovXG4gIHJlYWRvbmx5IGRlbGV0aW9uUHJvdGVjdGlvbkVuYWJsZWQ/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRvIGVuYWJsZSBEYXRhU3RvcmUgb3Igbm90XG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICByZWFkb25seSBzeW5jRW5hYmxlZD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFRoZSByb290IGRpcmVjdG9yeSB0byB1c2UgZm9yIGZpbmRpbmcgY3VzdG9tIHJlc29sdmVyc1xuICAgKiBAZGVmYXVsdCBwcm9jZXNzLmN3ZCgpXG4gICAqL1xuICByZWFkb25seSBjdXN0b21WdGxUcmFuc2Zvcm1lclJvb3REaXJlY3Rvcnk/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2NoZW1hVHJhbnNmb3JtZXJPdXRwdXRzIHtcbiAgcmVhZG9ubHkgY2RrVGFibGVzPzogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJUYWJsZSB9O1xuICByZWFkb25seSBub25lUmVzb2x2ZXJzPzogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJSZXNvbHZlciB9O1xuICByZWFkb25seSBmdW5jdGlvblJlc29sdmVycz86IHsgW25hbWU6IHN0cmluZ106IENka1RyYW5zZm9ybWVyRnVuY3Rpb25SZXNvbHZlcltdIH07XG4gIHJlYWRvbmx5IGh0dHBSZXNvbHZlcnM/OiB7IFtuYW1lOiBzdHJpbmddOiBDZGtUcmFuc2Zvcm1lckh0dHBSZXNvbHZlcltdIH07XG4gIHJlYWRvbmx5IHF1ZXJpZXM/OiB7IFtuYW1lOiBzdHJpbmddOiBzdHJpbmcgfTtcbiAgcmVhZG9ubHkgbXV0YXRpb25zPzogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJSZXNvbHZlciB9O1xuICByZWFkb25seSBzdWJzY3JpcHRpb25zPzogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJSZXNvbHZlciB9O1xufVxuXG5leHBvcnQgY2xhc3MgU2NoZW1hVHJhbnNmb3JtZXIge1xuICBwdWJsaWMgcmVhZG9ubHkgc2NoZW1hUGF0aDogc3RyaW5nXG4gIHB1YmxpYyByZWFkb25seSBvdXRwdXRQYXRoOiBzdHJpbmdcbiAgcHVibGljIHJlYWRvbmx5IGlzU3luY0VuYWJsZWQ6IGJvb2xlYW5cbiAgcHVibGljIHJlYWRvbmx5IGN1c3RvbVZ0bFRyYW5zZm9ybWVyUm9vdERpcmVjdG9yeTogc3RyaW5nO1xuXG4gIHByaXZhdGUgcmVhZG9ubHkgYXV0aFRyYW5zZm9ybWVyQ29uZmlnOiBNb2RlbEF1dGhUcmFuc2Zvcm1lckNvbmZpZ1xuXG4gIG91dHB1dHM6IFNjaGVtYVRyYW5zZm9ybWVyT3V0cHV0c1xuICByZXNvbHZlcnM6IGFueVxuICBhdXRoUm9sZVBvbGljeTogUmVzb3VyY2UgfCB1bmRlZmluZWRcbiAgdW5hdXRoUm9sZVBvbGljeTogUmVzb3VyY2UgfCB1bmRlZmluZWRcblxuICBjb25zdHJ1Y3Rvcihwcm9wczogU2NoZW1hVHJhbnNmb3JtZXJQcm9wcykge1xuICAgIHRoaXMuc2NoZW1hUGF0aCA9IHByb3BzLnNjaGVtYVBhdGggPz8gJy4vc2NoZW1hLmdyYXBocWwnO1xuICAgIHRoaXMub3V0cHV0UGF0aCA9IHByb3BzLm91dHB1dFBhdGggPz8gJy4vYXBwc3luYyc7XG4gICAgdGhpcy5pc1N5bmNFbmFibGVkID0gcHJvcHMuc3luY0VuYWJsZWQgPz8gZmFsc2U7XG4gICAgdGhpcy5jdXN0b21WdGxUcmFuc2Zvcm1lclJvb3REaXJlY3RvcnkgPSBwcm9wcy5jdXN0b21WdGxUcmFuc2Zvcm1lclJvb3REaXJlY3RvcnkgPz8gcHJvY2Vzcy5jd2QoKTtcblxuICAgIHRoaXMub3V0cHV0cyA9IHt9O1xuICAgIHRoaXMucmVzb2x2ZXJzID0ge307XG5cbiAgICAvLyBUT0RPOiBNYWtlIHRoaXMgYmV0dGVyP1xuICAgIHRoaXMuYXV0aFRyYW5zZm9ybWVyQ29uZmlnID0ge1xuICAgICAgYXV0aENvbmZpZzoge1xuICAgICAgICBkZWZhdWx0QXV0aGVudGljYXRpb246IHtcbiAgICAgICAgICBhdXRoZW50aWNhdGlvblR5cGU6ICdBTUFaT05fQ09HTklUT19VU0VSX1BPT0xTJyxcbiAgICAgICAgICB1c2VyUG9vbENvbmZpZzoge1xuICAgICAgICAgICAgdXNlclBvb2xJZDogJzEyMzQ1eHl6JyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBhZGRpdGlvbmFsQXV0aGVudGljYXRpb25Qcm92aWRlcnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBhdXRoZW50aWNhdGlvblR5cGU6ICdBUElfS0VZJyxcbiAgICAgICAgICAgIGFwaUtleUNvbmZpZzoge1xuICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1Rlc3RpbmcnLFxuICAgICAgICAgICAgICBhcGlLZXlFeHBpcmF0aW9uRGF5czogMTAwLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGF1dGhlbnRpY2F0aW9uVHlwZTogJ0FXU19JQU0nLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgYXV0aGVudGljYXRpb25UeXBlOiAnT1BFTklEX0NPTk5FQ1QnLFxuICAgICAgICAgICAgb3BlbklEQ29ubmVjdENvbmZpZzoge1xuICAgICAgICAgICAgICBuYW1lOiAnT0lEQycsXG4gICAgICAgICAgICAgIGlzc3VlclVybDogJ2h0dHBzOi8vY29nbml0by1pZHAudXMtZWFzdC0xLmFtYXpvbmF3cy5jb20vdXMtZWFzdC0xX1hYWCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBwdWJsaWMgdHJhbnNmb3JtKHByZUNka1RyYW5zZm9ybWVyczogSVRyYW5zZm9ybWVyW10gPSBbXSwgcG9zdENka1RyYW5zZm9ybWVyczogSVRyYW5zZm9ybWVyW10gPSBbXSkge1xuICAgIGNvbnN0IHRyYW5zZm9ybUNvbmZpZyA9IHRoaXMuaXNTeW5jRW5hYmxlZCA/IHRoaXMubG9hZENvbmZpZ1N5bmMoKSA6IHt9O1xuXG4gICAgY29uc3QgcHJvdmlkZXIgPSBuZXcgVHJhbnNmb3JtZXJGZWF0dXJlRmxhZ1Byb3ZpZGVyKCk7XG5cbiAgICAvLyBOb3RlOiBUaGlzIGlzIG5vdCBleGFjdCBhcyB3ZSBhcmUgb21pdHRpbmcgdGhlIEBzZWFyY2hhYmxlIHRyYW5zZm9ybWVyIGFzIHdlbGwgYXMgc29tZSBvdGhlcnMuXG4gICAgY29uc3QgdHJhbnNmb3JtZXIgPSBuZXcgR3JhcGhRTFRyYW5zZm9ybSh7XG4gICAgICB0cmFuc2Zvcm1Db25maWc6IHRyYW5zZm9ybUNvbmZpZyxcbiAgICAgIGZlYXR1cmVGbGFnczogcHJvdmlkZXIsXG4gICAgICB0cmFuc2Zvcm1lcnM6IFtcbiAgICAgICAgbmV3IER5bmFtb0RCTW9kZWxUcmFuc2Zvcm1lcigpLFxuICAgICAgICBuZXcgVHRsVHJhbnNmb3JtZXIoKSxcbiAgICAgICAgbmV3IFZlcnNpb25lZE1vZGVsVHJhbnNmb3JtZXIoKSxcbiAgICAgICAgbmV3IEZ1bmN0aW9uVHJhbnNmb3JtZXIoKSxcbiAgICAgICAgbmV3IEtleVRyYW5zZm9ybWVyKCksXG4gICAgICAgIG5ldyBNb2RlbENvbm5lY3Rpb25UcmFuc2Zvcm1lcigpLFxuICAgICAgICBuZXcgTW9kZWxBdXRoVHJhbnNmb3JtZXIodGhpcy5hdXRoVHJhbnNmb3JtZXJDb25maWcpLFxuICAgICAgICBuZXcgSHR0cFRyYW5zZm9ybWVyKCksXG4gICAgICAgIG5ldyBDdXN0b21WVExUcmFuc2Zvcm1lcih0aGlzLmN1c3RvbVZ0bFRyYW5zZm9ybWVyUm9vdERpcmVjdG9yeSksXG4gICAgICAgIC4uLnByZUNka1RyYW5zZm9ybWVycyxcbiAgICAgICAgbmV3IENka1RyYW5zZm9ybWVyKCksXG4gICAgICAgIC4uLnBvc3RDZGtUcmFuc2Zvcm1lcnMsXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgY29uc3Qgc2NoZW1hID0gZnMucmVhZEZpbGVTeW5jKHRoaXMuc2NoZW1hUGF0aCk7XG4gICAgY29uc3QgY2Zkb2MgPSB0cmFuc2Zvcm1lci50cmFuc2Zvcm0oc2NoZW1hLnRvU3RyaW5nKCkpO1xuXG4gICAgLy8gVE9ETzogR2V0IFVuYXV0aCBSb2xlIGFuZCBBdXRoIFJvbGUgcG9saWNpZXMgZm9yIGF1dGhvcml6YXRpb24gc3R1ZmZcbiAgICB0aGlzLnVuYXV0aFJvbGVQb2xpY3kgPSBjZmRvYy5yb290U3RhY2suUmVzb3VyY2VzPy5VbmF1dGhSb2xlUG9saWN5MDEgYXMgUmVzb3VyY2UgfHwgdW5kZWZpbmVkO1xuICAgIHRoaXMuYXV0aFJvbGVQb2xpY3kgPSBjZmRvYy5yb290U3RhY2suUmVzb3VyY2VzPy5BdXRoUm9sZVBvbGljeTAxIGFzIFJlc291cmNlIHx8IHVuZGVmaW5lZDtcblxuICAgIHRoaXMud3JpdGVTY2hlbWEoY2Zkb2Muc2NoZW1hKTtcbiAgICB0aGlzLndyaXRlUmVzb2x2ZXJzVG9GaWxlKGNmZG9jLnJlc29sdmVycyk7XG5cbiAgICAvLyBPdXRwdXRzIHNob3VsZG4ndCBiZSBudWxsIGJ1dCBkZWZhdWx0IHRvIGVtcHR5IG1hcFxuICAgIHRoaXMub3V0cHV0cyA9IGNmZG9jLnJvb3RTdGFjay5PdXRwdXRzID8/IHt9O1xuXG4gICAgcmV0dXJuIHRoaXMub3V0cHV0cztcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSByZXNvbHZlcnMgZnJvbSB0aGUgYC4vYXBwc3luYy9yZXNvbHZlcnNgIGZvbGRlclxuICAgKiBAcmV0dXJucyBhbGwgcmVzb2x2ZXJzXG4gICAqL1xuICBwdWJsaWMgZ2V0UmVzb2x2ZXJzKCkge1xuICAgIGNvbnN0IHN0YXRlbWVudHMgPSBbJ1F1ZXJ5JywgJ011dGF0aW9uJ107XG4gICAgY29uc3QgcmVzb2x2ZXJzRGlyUGF0aCA9IG5vcm1hbGl6ZSgnLi9hcHBzeW5jL3Jlc29sdmVycycpO1xuICAgIGlmIChmcy5leGlzdHNTeW5jKHJlc29sdmVyc0RpclBhdGgpKSB7XG4gICAgICBjb25zdCBmaWxlcyA9IGZzLnJlYWRkaXJTeW5jKHJlc29sdmVyc0RpclBhdGgpO1xuICAgICAgZmlsZXMuZm9yRWFjaChmaWxlID0+IHtcbiAgICAgICAgLy8gRXhhbXBsZTogTXV0YXRpb24uY3JlYXRlQ2hhbm5lbC5yZXNwb25zZVxuICAgICAgICBsZXQgYXJncyA9IGZpbGUuc3BsaXQoJy4nKTtcbiAgICAgICAgbGV0IHR5cGVOYW1lOiBzdHJpbmcgPSBhcmdzWzBdO1xuICAgICAgICBsZXQgZmllbGROYW1lOiBzdHJpbmcgPSBhcmdzWzFdO1xuICAgICAgICBsZXQgdGVtcGxhdGVUeXBlID0gYXJnc1syXTsgLy8gcmVxdWVzdCBvciByZXNwb25zZVxuXG4gICAgICAgIC8vIGRlZmF1bHQgdG8gY29tcG9zaXRlIGtleSBvZiB0eXBlTmFtZSBhbmQgZmllbGROYW1lLCBob3dldmVyIGlmIGl0XG4gICAgICAgIC8vIGlzIFF1ZXJ5LCBNdXRhdGlvbiBvciBTdWJzY3JpcHRpb24gKHRvcCBsZXZlbCkgdGhlIGNvbXBvc2l0ZUtleSBpcyB0aGVcbiAgICAgICAgLy8gc2FtZSBhcyBmaWVsZE5hbWUgb25seVxuICAgICAgICBsZXQgY29tcG9zaXRlS2V5ID0gYCR7dHlwZU5hbWV9JHtmaWVsZE5hbWV9YDtcbiAgICAgICAgaWYgKHN0YXRlbWVudHMuaW5kZXhPZih0eXBlTmFtZSkgPj0gMCkge1xuICAgICAgICAgIGlmICghdGhpcy5vdXRwdXRzLm5vbmVSZXNvbHZlcnMgfHwgIXRoaXMub3V0cHV0cy5ub25lUmVzb2x2ZXJzW2NvbXBvc2l0ZUtleV0pIGNvbXBvc2l0ZUtleSA9IGZpZWxkTmFtZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBmaWxlcGF0aCA9IG5vcm1hbGl6ZShgJHtyZXNvbHZlcnNEaXJQYXRofS8ke2ZpbGV9YCk7XG5cbiAgICAgICAgaWYgKHN0YXRlbWVudHMuaW5kZXhPZih0eXBlTmFtZSkgPj0gMCB8fCAodGhpcy5vdXRwdXRzLm5vbmVSZXNvbHZlcnMgJiYgdGhpcy5vdXRwdXRzLm5vbmVSZXNvbHZlcnNbY29tcG9zaXRlS2V5XSkpIHtcbiAgICAgICAgICBpZiAoIXRoaXMucmVzb2x2ZXJzW2NvbXBvc2l0ZUtleV0pIHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZXJzW2NvbXBvc2l0ZUtleV0gPSB7XG4gICAgICAgICAgICAgIHR5cGVOYW1lOiB0eXBlTmFtZSxcbiAgICAgICAgICAgICAgZmllbGROYW1lOiBmaWVsZE5hbWUsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh0ZW1wbGF0ZVR5cGUgPT09ICdyZXEnKSB7XG4gICAgICAgICAgICB0aGlzLnJlc29sdmVyc1tjb21wb3NpdGVLZXldLnJlcXVlc3RNYXBwaW5nVGVtcGxhdGUgPSBmaWxlcGF0aDtcbiAgICAgICAgICB9IGVsc2UgaWYgKHRlbXBsYXRlVHlwZSA9PT0gJ3JlcycpIHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZXJzW2NvbXBvc2l0ZUtleV0ucmVzcG9uc2VNYXBwaW5nVGVtcGxhdGUgPSBmaWxlcGF0aDtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5pc0h0dHBSZXNvbHZlcih0eXBlTmFtZSwgZmllbGROYW1lKSkge1xuICAgICAgICAgIGlmICghdGhpcy5yZXNvbHZlcnNbY29tcG9zaXRlS2V5XSkge1xuICAgICAgICAgICAgdGhpcy5yZXNvbHZlcnNbY29tcG9zaXRlS2V5XSA9IHtcbiAgICAgICAgICAgICAgdHlwZU5hbWU6IHR5cGVOYW1lLFxuICAgICAgICAgICAgICBmaWVsZE5hbWU6IGZpZWxkTmFtZSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHRlbXBsYXRlVHlwZSA9PT0gJ3JlcScpIHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZXJzW2NvbXBvc2l0ZUtleV0ucmVxdWVzdE1hcHBpbmdUZW1wbGF0ZSA9IGZpbGVwYXRoO1xuICAgICAgICAgIH0gZWxzZSBpZiAodGVtcGxhdGVUeXBlID09PSAncmVzJykge1xuICAgICAgICAgICAgdGhpcy5yZXNvbHZlcnNbY29tcG9zaXRlS2V5XS5yZXNwb25zZU1hcHBpbmdUZW1wbGF0ZSA9IGZpbGVwYXRoO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHsgLy8gVGhpcyBpcyBhIEdTSVxuICAgICAgICAgIGlmICghdGhpcy5yZXNvbHZlcnMuZ3NpKSB7XG4gICAgICAgICAgICB0aGlzLnJlc29sdmVycy5nc2kgPSB7fTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKCF0aGlzLnJlc29sdmVycy5nc2lbY29tcG9zaXRlS2V5XSkge1xuICAgICAgICAgICAgdGhpcy5yZXNvbHZlcnMuZ3NpW2NvbXBvc2l0ZUtleV0gPSB7XG4gICAgICAgICAgICAgIHR5cGVOYW1lOiB0eXBlTmFtZSxcbiAgICAgICAgICAgICAgZmllbGROYW1lOiBmaWVsZE5hbWUsXG4gICAgICAgICAgICAgIHRhYmxlTmFtZTogZmllbGROYW1lLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgZmllbGROYW1lLnNsaWNlKDEpLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAodGVtcGxhdGVUeXBlID09PSAncmVxJykge1xuICAgICAgICAgICAgdGhpcy5yZXNvbHZlcnMuZ3NpW2NvbXBvc2l0ZUtleV0ucmVxdWVzdE1hcHBpbmdUZW1wbGF0ZSA9IGZpbGVwYXRoO1xuICAgICAgICAgIH0gZWxzZSBpZiAodGVtcGxhdGVUeXBlID09PSAncmVzJykge1xuICAgICAgICAgICAgdGhpcy5yZXNvbHZlcnMuZ3NpW2NvbXBvc2l0ZUtleV0ucmVzcG9uc2VNYXBwaW5nVGVtcGxhdGUgPSBmaWxlcGF0aDtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnJlc29sdmVycztcbiAgfVxuXG4gIC8qKlxuICAgKiBkZWNpZGVzIGlmIHRoaXMgaXMgYSByZXNvbHZlciBmb3IgYW4gSFRUUCBkYXRhc291cmNlXG4gICAqIEBwYXJhbSB0eXBlTmFtZVxuICAgKiBAcGFyYW0gZmllbGROYW1lXG4gICAqL1xuXG4gIHByaXZhdGUgaXNIdHRwUmVzb2x2ZXIodHlwZU5hbWU6IHN0cmluZywgZmllbGROYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAoIXRoaXMub3V0cHV0cy5odHRwUmVzb2x2ZXJzKSByZXR1cm4gZmFsc2U7XG5cbiAgICBmb3IgKGNvbnN0IGVuZHBvaW50IGluIHRoaXMub3V0cHV0cy5odHRwUmVzb2x2ZXJzKSB7XG4gICAgICBmb3IgKGNvbnN0IHJlc29sdmVyIG9mIHRoaXMub3V0cHV0cy5odHRwUmVzb2x2ZXJzW2VuZHBvaW50XSkge1xuICAgICAgICBpZiAocmVzb2x2ZXIudHlwZU5hbWUgPT09IHR5cGVOYW1lICYmIHJlc29sdmVyLmZpZWxkTmFtZSA9PT0gZmllbGROYW1lKSByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvKipcbiAgICAgKiBXcml0ZXMgdGhlIHNjaGVtYSB0byB0aGUgb3V0cHV0IGRpcmVjdG9yeSBmb3IgdXNlIHdpdGggQGF3cy1jZGsvYXdzLWFwcHN5bmNcbiAgICAgKiBAcGFyYW0gc2NoZW1hXG4gICAgICovXG4gIHByaXZhdGUgd3JpdGVTY2hlbWEoc2NoZW1hOiBhbnkpIHtcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmModGhpcy5vdXRwdXRQYXRoKSkge1xuICAgICAgZnMubWtkaXJTeW5jKHRoaXMub3V0cHV0UGF0aCk7XG4gICAgfVxuXG4gICAgZnMud3JpdGVGaWxlU3luYyhgJHt0aGlzLm91dHB1dFBhdGh9L3NjaGVtYS5ncmFwaHFsYCwgc2NoZW1hKTtcbiAgfVxuXG4gIC8qKlxuICAgICAqIFdyaXRlcyBhbGwgdGhlIHJlc29sdmVycyB0byB0aGUgb3V0cHV0IGRpcmVjdG9yeSBmb3IgbG9hZGluZyBpbnRvIHRoZSBkYXRhc291cmNlcyBsYXRlclxuICAgICAqIEBwYXJhbSByZXNvbHZlcnNcbiAgICAgKi9cbiAgcHJpdmF0ZSB3cml0ZVJlc29sdmVyc1RvRmlsZShyZXNvbHZlcnM6IGFueSkge1xuICAgIGlmICghZnMuZXhpc3RzU3luYyh0aGlzLm91dHB1dFBhdGgpKSB7XG4gICAgICBmcy5ta2RpclN5bmModGhpcy5vdXRwdXRQYXRoKTtcbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlckZvbGRlclBhdGggPSBub3JtYWxpemUodGhpcy5vdXRwdXRQYXRoICsgJy9yZXNvbHZlcnMnKTtcbiAgICBpZiAoZnMuZXhpc3RzU3luYyhyZXNvbHZlckZvbGRlclBhdGgpKSB7XG4gICAgICBjb25zdCBmaWxlcyA9IGZzLnJlYWRkaXJTeW5jKHJlc29sdmVyRm9sZGVyUGF0aCk7XG4gICAgICBmaWxlcy5mb3JFYWNoKGZpbGUgPT4gZnMudW5saW5rU3luYyhyZXNvbHZlckZvbGRlclBhdGggKyAnLycgKyBmaWxlKSk7XG4gICAgICBmcy5ybWRpclN5bmMocmVzb2x2ZXJGb2xkZXJQYXRoKTtcbiAgICB9XG5cbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMocmVzb2x2ZXJGb2xkZXJQYXRoKSkge1xuICAgICAgZnMubWtkaXJTeW5jKHJlc29sdmVyRm9sZGVyUGF0aCk7XG4gICAgfVxuXG4gICAgT2JqZWN0LmtleXMocmVzb2x2ZXJzKS5mb3JFYWNoKChrZXk6IGFueSkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZXIgPSByZXNvbHZlcnNba2V5XTtcbiAgICAgIGNvbnN0IGZpbGVOYW1lID0ga2V5LnJlcGxhY2UoJy52dGwnLCAnJyk7XG4gICAgICBjb25zdCByZXNvbHZlckZpbGVQYXRoID0gbm9ybWFsaXplKGAke3Jlc29sdmVyRm9sZGVyUGF0aH0vJHtmaWxlTmFtZX1gKTtcbiAgICAgIGZzLndyaXRlRmlsZVN5bmMocmVzb2x2ZXJGaWxlUGF0aCwgcmVzb2x2ZXIpO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAgICogQHJldHVybnMge0BsaW5rIFRyYW5zZm9ybUNvbmZpZ31cbiAgICAqL1xuICBwcml2YXRlIGxvYWRDb25maWdTeW5jKHByb2plY3REaXI6IHN0cmluZyA9ICdyZXNvdXJjZXMnKTogVHJhbnNmb3JtQ29uZmlnIHtcbiAgICAvLyBJbml0aWFsaXplIHRoZSBjb25maWcgYWx3YXlzIHdpdGggdGhlIGxhdGVzdCB2ZXJzaW9uLCBvdGhlciBtZW1iZXJzIGFyZSBvcHRpb25hbCBmb3Igbm93LlxuICAgIGxldCBjb25maWc6IFRyYW5zZm9ybUNvbmZpZyA9IHtcbiAgICAgIFZlcnNpb246IFRSQU5TRk9STV9DVVJSRU5UX1ZFUlNJT04sXG4gICAgICBSZXNvbHZlckNvbmZpZzoge1xuICAgICAgICBwcm9qZWN0OiB7XG4gICAgICAgICAgQ29uZmxpY3RIYW5kbGVyOiBDb25mbGljdEhhbmRsZXJUeXBlLk9QVElNSVNUSUMsXG4gICAgICAgICAgQ29uZmxpY3REZXRlY3Rpb246ICdWRVJTSU9OJyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIGNvbnN0IGNvbmZpZ0RpciA9IGpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLi4nLCBwcm9qZWN0RGlyKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjb25maWdQYXRoID0gam9pbihjb25maWdEaXIsIFRSQU5TRk9STV9DT05GSUdfRklMRV9OQU1FKTtcbiAgICAgIGNvbnN0IGNvbmZpZ0V4aXN0cyA9IGZzLmV4aXN0c1N5bmMoY29uZmlnUGF0aCk7XG4gICAgICBpZiAoY29uZmlnRXhpc3RzKSB7XG4gICAgICAgIGNvbnN0IGNvbmZpZ1N0ciA9IGZzLnJlYWRGaWxlU3luYyhjb25maWdQYXRoKTtcbiAgICAgICAgY29uZmlnID0gSlNPTi5wYXJzZShjb25maWdTdHIudG9TdHJpbmcoKSk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjb25maWcgYXMgVHJhbnNmb3JtQ29uZmlnO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgcmV0dXJuIGNvbmZpZztcbiAgICB9XG4gIH1cbn1cblxuXG4vKipcbiAqIEdyYWJiZWQgZnJvbSBBbXBsaWZ5XG4gKiBodHRwczovL2dpdGh1Yi5jb20vYXdzLWFtcGxpZnkvYW1wbGlmeS1jbGkvYmxvYi9lYjkyNTdlYWVlMTE3ZDBlZDUzZWJjMjNhYTI4ZWNkN2I3NTEwZmExL3BhY2thZ2VzL2dyYXBocWwtdHJhbnNmb3JtZXItY29yZS9zcmMvRmVhdHVyZUZsYWdzLnRzXG4gKi9cbmV4cG9ydCBjbGFzcyBUcmFuc2Zvcm1lckZlYXR1cmVGbGFnUHJvdmlkZXIgaW1wbGVtZW50cyBGZWF0dXJlRmxhZ1Byb3ZpZGVyIHtcbiAgZ2V0Qm9vbGVhbihmZWF0dXJlTmFtZTogc3RyaW5nLCBvcHRpb25zPzogYm9vbGVhbik6IGJvb2xlYW4ge1xuICAgIHN3aXRjaCAoZmVhdHVyZU5hbWUpIHtcbiAgICAgIGNhc2UgJ2ltcHJvdmVQbHVyYWxpemF0aW9uJzpcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICBjYXNlICd2YWxpZGF0ZVR5cGVOYW1lUmVzZXJ2ZWRXb3Jkcyc6XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiB0aGlzLmdldFZhbHVlPGJvb2xlYW4+KGZlYXR1cmVOYW1lLCBvcHRpb25zKTtcbiAgICB9XG4gIH1cbiAgZ2V0U3RyaW5nKGZlYXR1cmVOYW1lOiBzdHJpbmcsIG9wdGlvbnM/OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLmdldFZhbHVlPHN0cmluZz4oZmVhdHVyZU5hbWUsIG9wdGlvbnMpO1xuICB9XG4gIGdldE51bWJlcihmZWF0dXJlTmFtZTogc3RyaW5nLCBvcHRpb25zPzogbnVtYmVyKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5nZXRWYWx1ZTxudW1iZXI+KGZlYXR1cmVOYW1lLCBvcHRpb25zKTtcbiAgfVxuICBnZXRPYmplY3QoKTogb2JqZWN0IHtcbiAgICAvLyBUb2RvOiBmb3IgZnV0dXJlIGV4dGVuc2liaWxpdHlcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ05vdCBpbXBsZW1lbnRlZCcpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldFZhbHVlPFQgZXh0ZW5kcyBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuPihmZWF0dXJlTmFtZTogc3RyaW5nLCBkZWZhdWx0VmFsdWU/OiBUKTogVCB7XG4gICAgaWYgKGRlZmF1bHRWYWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gZGVmYXVsdFZhbHVlO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHZhbHVlIGZvdW5kIGZvciBmZWF0dXJlICR7ZmVhdHVyZU5hbWV9YCk7XG4gIH1cbn0iXX0=