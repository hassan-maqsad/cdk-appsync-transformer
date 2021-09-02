"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchemaTransformer = void 0;
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
// Import this way because FunctionTransformer.d.ts types were throwing an eror. And we didn't write this package so hope for the best :P
// eslint-disable-next-line
const { FunctionTransformer } = require('graphql-function-transformer');
class SchemaTransformer {
    constructor(props) {
        this.schemaPath = props.schemaPath || './schema.graphql';
        this.outputPath = props.outputPath || './appsync';
        this.isSyncEnabled = props.syncEnabled || false;
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
        // Note: This is not exact as we are omitting the @searchable transformer as well as some others.
        const transformer = new graphql_transformer_core_1.GraphQLTransform({
            transformConfig: transformConfig,
            transformers: [
                new graphql_dynamodb_transformer_1.DynamoDBModelTransformer(),
                new graphql_ttl_transformer_1.default(),
                new graphql_versioned_transformer_1.VersionedModelTransformer(),
                new FunctionTransformer(),
                new graphql_key_transformer_1.KeyTransformer(),
                new graphql_connection_transformer_1.ModelConnectionTransformer(),
                new graphql_auth_transformer_1.ModelAuthTransformer(this.authTransformerConfig),
                new graphql_http_transformer_1.HttpTransformer(),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hLXRyYW5zZm9ybWVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3RyYW5zZm9ybWVyL3NjaGVtYS10cmFuc2Zvcm1lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSx5QkFBeUI7QUFDekIsK0JBQXVDO0FBQ3ZDLHVFQUE0RjtBQUM1RixtRkFBNEU7QUFDNUUsK0VBQXdFO0FBQ3hFLHVFQUEyRDtBQUMzRCxxRUFBeUQ7QUFDekQsdUVBQXVLO0FBQ3ZLLHFFQUFxRDtBQUNyRCxpRkFBMEU7QUFFMUUsdURBTTJCO0FBSzNCLHlJQUF5STtBQUN6SSwyQkFBMkI7QUFDM0IsTUFBTSxFQUFFLG1CQUFtQixFQUFFLEdBQUcsT0FBTyxDQUFDLDhCQUE4QixDQUFDLENBQUM7QUFzQ3hFLE1BQWEsaUJBQWlCO0lBWTVCLFlBQVksS0FBNkI7UUFDdkMsSUFBSSxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUMsVUFBVSxJQUFJLGtCQUFrQixDQUFDO1FBQ3pELElBQUksQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFDLFVBQVUsSUFBSSxXQUFXLENBQUM7UUFDbEQsSUFBSSxDQUFDLGFBQWEsR0FBRyxLQUFLLENBQUMsV0FBVyxJQUFJLEtBQUssQ0FBQztRQUVoRCxJQUFJLENBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztRQUNsQixJQUFJLENBQUMsU0FBUyxHQUFHLEVBQUUsQ0FBQztRQUVwQiwwQkFBMEI7UUFDMUIsSUFBSSxDQUFDLHFCQUFxQixHQUFHO1lBQzNCLFVBQVUsRUFBRTtnQkFDVixxQkFBcUIsRUFBRTtvQkFDckIsa0JBQWtCLEVBQUUsMkJBQTJCO29CQUMvQyxjQUFjLEVBQUU7d0JBQ2QsVUFBVSxFQUFFLFVBQVU7cUJBQ3ZCO2lCQUNGO2dCQUNELGlDQUFpQyxFQUFFO29CQUNqQzt3QkFDRSxrQkFBa0IsRUFBRSxTQUFTO3dCQUM3QixZQUFZLEVBQUU7NEJBQ1osV0FBVyxFQUFFLFNBQVM7NEJBQ3RCLG9CQUFvQixFQUFFLEdBQUc7eUJBQzFCO3FCQUNGO29CQUNEO3dCQUNFLGtCQUFrQixFQUFFLFNBQVM7cUJBQzlCO29CQUNEO3dCQUNFLGtCQUFrQixFQUFFLGdCQUFnQjt3QkFDcEMsbUJBQW1CLEVBQUU7NEJBQ25CLElBQUksRUFBRSxNQUFNOzRCQUNaLFNBQVMsRUFBRSwyREFBMkQ7eUJBQ3ZFO3FCQUNGO2lCQUNGO2FBQ0Y7U0FDRixDQUFDO0lBQ0osQ0FBQztJQUVNLFNBQVMsQ0FBQyxxQkFBcUMsRUFBRSxFQUFFLHNCQUFzQyxFQUFFOztRQUNoRyxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztRQUV4RSxpR0FBaUc7UUFDakcsTUFBTSxXQUFXLEdBQUcsSUFBSSwyQ0FBZ0IsQ0FBQztZQUN2QyxlQUFlLEVBQUUsZUFBZTtZQUNoQyxZQUFZLEVBQUU7Z0JBQ1osSUFBSSx1REFBd0IsRUFBRTtnQkFDOUIsSUFBSSxpQ0FBYyxFQUFFO2dCQUNwQixJQUFJLHlEQUF5QixFQUFFO2dCQUMvQixJQUFJLG1CQUFtQixFQUFFO2dCQUN6QixJQUFJLHdDQUFjLEVBQUU7Z0JBQ3BCLElBQUksMkRBQTBCLEVBQUU7Z0JBQ2hDLElBQUksK0NBQW9CLENBQUMsSUFBSSxDQUFDLHFCQUFxQixDQUFDO2dCQUNwRCxJQUFJLDBDQUFlLEVBQUU7Z0JBQ3JCLEdBQUcsa0JBQWtCO2dCQUNyQixJQUFJLGdDQUFjLEVBQUU7Z0JBQ3BCLEdBQUcsbUJBQW1CO2FBQ3ZCO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDaEQsTUFBTSxLQUFLLEdBQUcsV0FBVyxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQztRQUV2RCx1RUFBdUU7UUFDdkUsSUFBSSxDQUFDLGdCQUFnQixHQUFHLENBQUEsTUFBQSxLQUFLLENBQUMsU0FBUyxDQUFDLFNBQVMsMENBQUUsa0JBQThCLEtBQUksU0FBUyxDQUFDO1FBQy9GLElBQUksQ0FBQyxjQUFjLEdBQUcsQ0FBQSxNQUFBLEtBQUssQ0FBQyxTQUFTLENBQUMsU0FBUywwQ0FBRSxnQkFBNEIsS0FBSSxTQUFTLENBQUM7UUFFM0YsSUFBSSxDQUFDLFdBQVcsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDL0IsSUFBSSxDQUFDLG9CQUFvQixDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUUzQyxxREFBcUQ7UUFDckQsSUFBSSxDQUFDLE9BQU8sU0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDLE9BQU8sbUNBQUksRUFBRSxDQUFDO1FBRTdDLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQztJQUN0QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0ksWUFBWTtRQUNqQixNQUFNLFVBQVUsR0FBRyxDQUFDLE9BQU8sRUFBRSxVQUFVLENBQUMsQ0FBQztRQUN6QyxNQUFNLGdCQUFnQixHQUFHLGdCQUFTLENBQUMscUJBQXFCLENBQUMsQ0FBQztRQUMxRCxJQUFJLEVBQUUsQ0FBQyxVQUFVLENBQUMsZ0JBQWdCLENBQUMsRUFBRTtZQUNuQyxNQUFNLEtBQUssR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLGdCQUFnQixDQUFDLENBQUM7WUFDL0MsS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRTtnQkFDbkIsMkNBQTJDO2dCQUMzQyxJQUFJLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUMzQixJQUFJLFFBQVEsR0FBVyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQy9CLElBQUksU0FBUyxHQUFXLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDaEMsSUFBSSxZQUFZLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsc0JBQXNCO2dCQUVsRCxvRUFBb0U7Z0JBQ3BFLHlFQUF5RTtnQkFDekUseUJBQXlCO2dCQUN6QixJQUFJLFlBQVksR0FBRyxHQUFHLFFBQVEsR0FBRyxTQUFTLEVBQUUsQ0FBQztnQkFDN0MsSUFBSSxVQUFVLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRTtvQkFDckMsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsYUFBYSxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDO3dCQUFFLFlBQVksR0FBRyxTQUFTLENBQUM7aUJBQ3hHO2dCQUVELElBQUksUUFBUSxHQUFHLGdCQUFTLENBQUMsR0FBRyxnQkFBZ0IsSUFBSSxJQUFJLEVBQUUsQ0FBQyxDQUFDO2dCQUV4RCxJQUFJLFVBQVUsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDLENBQUMsRUFBRTtvQkFDakgsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLEVBQUU7d0JBQ2pDLElBQUksQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLEdBQUc7NEJBQzdCLFFBQVEsRUFBRSxRQUFROzRCQUNsQixTQUFTLEVBQUUsU0FBUzt5QkFDckIsQ0FBQztxQkFDSDtvQkFFRCxJQUFJLFlBQVksS0FBSyxLQUFLLEVBQUU7d0JBQzFCLElBQUksQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLENBQUMsc0JBQXNCLEdBQUcsUUFBUSxDQUFDO3FCQUNoRTt5QkFBTSxJQUFJLFlBQVksS0FBSyxLQUFLLEVBQUU7d0JBQ2pDLElBQUksQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLENBQUMsdUJBQXVCLEdBQUcsUUFBUSxDQUFDO3FCQUNqRTtpQkFDRjtxQkFBTSxJQUFJLElBQUksQ0FBQyxjQUFjLENBQUMsUUFBUSxFQUFFLFNBQVMsQ0FBQyxFQUFFO29CQUNuRCxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsRUFBRTt3QkFDakMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsR0FBRzs0QkFDN0IsUUFBUSxFQUFFLFFBQVE7NEJBQ2xCLFNBQVMsRUFBRSxTQUFTO3lCQUNyQixDQUFDO3FCQUNIO29CQUVELElBQUksWUFBWSxLQUFLLEtBQUssRUFBRTt3QkFDMUIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxzQkFBc0IsR0FBRyxRQUFRLENBQUM7cUJBQ2hFO3lCQUFNLElBQUksWUFBWSxLQUFLLEtBQUssRUFBRTt3QkFDakMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsQ0FBQyx1QkFBdUIsR0FBRyxRQUFRLENBQUM7cUJBQ2pFO2lCQUNGO3FCQUFNLEVBQUUsZ0JBQWdCO29CQUN2QixJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUU7d0JBQ3ZCLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxHQUFHLEVBQUUsQ0FBQztxQkFDekI7b0JBQ0QsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxFQUFFO3dCQUNyQyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsR0FBRzs0QkFDakMsUUFBUSxFQUFFLFFBQVE7NEJBQ2xCLFNBQVMsRUFBRSxTQUFTOzRCQUNwQixTQUFTLEVBQUUsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQUUsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQzt5QkFDbEUsQ0FBQztxQkFDSDtvQkFFRCxJQUFJLFlBQVksS0FBSyxLQUFLLEVBQUU7d0JBQzFCLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxDQUFDLHNCQUFzQixHQUFHLFFBQVEsQ0FBQztxQkFDcEU7eUJBQU0sSUFBSSxZQUFZLEtBQUssS0FBSyxFQUFFO3dCQUNqQyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQyx1QkFBdUIsR0FBRyxRQUFRLENBQUM7cUJBQ3JFO2lCQUNGO1lBQ0gsQ0FBQyxDQUFDLENBQUM7U0FDSjtRQUVELE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQztJQUN4QixDQUFDO0lBRUQ7Ozs7T0FJRztJQUVLLGNBQWMsQ0FBQyxRQUFnQixFQUFFLFNBQWlCO1FBQ3hELElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLGFBQWE7WUFBRSxPQUFPLEtBQUssQ0FBQztRQUU5QyxLQUFLLE1BQU0sUUFBUSxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsYUFBYSxFQUFFO1lBQ2pELEtBQUssTUFBTSxRQUFRLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLEVBQUU7Z0JBQzNELElBQUksUUFBUSxDQUFDLFFBQVEsS0FBSyxRQUFRLElBQUksUUFBUSxDQUFDLFNBQVMsS0FBSyxTQUFTO29CQUFFLE9BQU8sSUFBSSxDQUFDO2FBQ3JGO1NBQ0Y7UUFFRCxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFFRDs7O1NBR0s7SUFDRyxXQUFXLENBQUMsTUFBVztRQUM3QixJQUFJLENBQUMsRUFBRSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUU7WUFDbkMsRUFBRSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7U0FDL0I7UUFFRCxFQUFFLENBQUMsYUFBYSxDQUFDLEdBQUcsSUFBSSxDQUFDLFVBQVUsaUJBQWlCLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFDaEUsQ0FBQztJQUVEOzs7U0FHSztJQUNHLG9CQUFvQixDQUFDLFNBQWM7UUFDekMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxFQUFFO1lBQ25DLEVBQUUsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1NBQy9CO1FBRUQsTUFBTSxrQkFBa0IsR0FBRyxnQkFBUyxDQUFDLElBQUksQ0FBQyxVQUFVLEdBQUcsWUFBWSxDQUFDLENBQUM7UUFDckUsSUFBSSxFQUFFLENBQUMsVUFBVSxDQUFDLGtCQUFrQixDQUFDLEVBQUU7WUFDckMsTUFBTSxLQUFLLEdBQUcsRUFBRSxDQUFDLFdBQVcsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1lBQ2pELEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLGtCQUFrQixHQUFHLEdBQUcsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDO1lBQ3RFLEVBQUUsQ0FBQyxTQUFTLENBQUMsa0JBQWtCLENBQUMsQ0FBQztTQUNsQztRQUVELElBQUksQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLGtCQUFrQixDQUFDLEVBQUU7WUFDdEMsRUFBRSxDQUFDLFNBQVMsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1NBQ2xDO1FBRUQsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxHQUFRLEVBQUUsRUFBRTtZQUMxQyxNQUFNLFFBQVEsR0FBRyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDaEMsTUFBTSxRQUFRLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDekMsTUFBTSxnQkFBZ0IsR0FBRyxnQkFBUyxDQUFDLEdBQUcsa0JBQWtCLElBQUksUUFBUSxFQUFFLENBQUMsQ0FBQztZQUN4RSxFQUFFLENBQUMsYUFBYSxDQUFDLGdCQUFnQixFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBQy9DLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztRQUVJO0lBQ0ksY0FBYyxDQUFDLGFBQXFCLFdBQVc7UUFDckQsNEZBQTRGO1FBQzVGLElBQUksTUFBTSxHQUFvQjtZQUM1QixPQUFPLEVBQUUsb0RBQXlCO1lBQ2xDLGNBQWMsRUFBRTtnQkFDZCxPQUFPLEVBQUU7b0JBQ1AsZUFBZSwyQ0FBZ0M7b0JBQy9DLGlCQUFpQixFQUFFLFNBQVM7aUJBQzdCO2FBQ0Y7U0FDRixDQUFDO1FBRUYsTUFBTSxTQUFTLEdBQUcsV0FBSSxDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFVBQVUsQ0FBQyxDQUFDO1FBRTFELElBQUk7WUFDRixNQUFNLFVBQVUsR0FBRyxXQUFJLENBQUMsU0FBUyxFQUFFLHFEQUEwQixDQUFDLENBQUM7WUFDL0QsTUFBTSxZQUFZLEdBQUcsRUFBRSxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsQ0FBQztZQUMvQyxJQUFJLFlBQVksRUFBRTtnQkFDaEIsTUFBTSxTQUFTLEdBQUcsRUFBRSxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQUMsQ0FBQztnQkFDOUMsTUFBTSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUM7YUFDM0M7WUFFRCxPQUFPLE1BQXlCLENBQUM7U0FDbEM7UUFBQyxPQUFPLEdBQUcsRUFBRTtZQUNaLE9BQU8sTUFBTSxDQUFDO1NBQ2Y7SUFDSCxDQUFDO0NBQ0Y7QUE3UEQsOENBNlBDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IHsgbm9ybWFsaXplLCBqb2luIH0gZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBNb2RlbEF1dGhUcmFuc2Zvcm1lciwgTW9kZWxBdXRoVHJhbnNmb3JtZXJDb25maWcgfSBmcm9tICdncmFwaHFsLWF1dGgtdHJhbnNmb3JtZXInO1xuaW1wb3J0IHsgTW9kZWxDb25uZWN0aW9uVHJhbnNmb3JtZXIgfSBmcm9tICdncmFwaHFsLWNvbm5lY3Rpb24tdHJhbnNmb3JtZXInO1xuaW1wb3J0IHsgRHluYW1vREJNb2RlbFRyYW5zZm9ybWVyIH0gZnJvbSAnZ3JhcGhxbC1keW5hbW9kYi10cmFuc2Zvcm1lcic7XG5pbXBvcnQgeyBIdHRwVHJhbnNmb3JtZXIgfSBmcm9tICdncmFwaHFsLWh0dHAtdHJhbnNmb3JtZXInO1xuaW1wb3J0IHsgS2V5VHJhbnNmb3JtZXIgfSBmcm9tICdncmFwaHFsLWtleS10cmFuc2Zvcm1lcic7XG5pbXBvcnQgeyBHcmFwaFFMVHJhbnNmb3JtLCBUcmFuc2Zvcm1Db25maWcsIFRSQU5TRk9STV9DVVJSRU5UX1ZFUlNJT04sIFRSQU5TRk9STV9DT05GSUdfRklMRV9OQU1FLCBDb25mbGljdEhhbmRsZXJUeXBlLCBJVHJhbnNmb3JtZXIgfSBmcm9tICdncmFwaHFsLXRyYW5zZm9ybWVyLWNvcmUnO1xuaW1wb3J0IFR0bFRyYW5zZm9ybWVyIGZyb20gJ2dyYXBocWwtdHRsLXRyYW5zZm9ybWVyJztcbmltcG9ydCB7IFZlcnNpb25lZE1vZGVsVHJhbnNmb3JtZXIgfSBmcm9tICdncmFwaHFsLXZlcnNpb25lZC10cmFuc2Zvcm1lcic7XG5cbmltcG9ydCB7XG4gIENka1RyYW5zZm9ybWVyLFxuICBDZGtUcmFuc2Zvcm1lclRhYmxlLFxuICBDZGtUcmFuc2Zvcm1lclJlc29sdmVyLFxuICBDZGtUcmFuc2Zvcm1lckZ1bmN0aW9uUmVzb2x2ZXIsXG4gIENka1RyYW5zZm9ybWVySHR0cFJlc29sdmVyLFxufSBmcm9tICcuL2Nkay10cmFuc2Zvcm1lcic7XG5cbi8vIFJlYnVpbHQgdGhpcyBmcm9tIGNsb3VkZm9ybS10eXBlcyBiZWNhdXNlIGl0IGhhcyB0eXBlIGVycm9yc1xuaW1wb3J0IHsgUmVzb3VyY2UgfSBmcm9tICcuL3Jlc291cmNlJztcblxuLy8gSW1wb3J0IHRoaXMgd2F5IGJlY2F1c2UgRnVuY3Rpb25UcmFuc2Zvcm1lci5kLnRzIHR5cGVzIHdlcmUgdGhyb3dpbmcgYW4gZXJvci4gQW5kIHdlIGRpZG4ndCB3cml0ZSB0aGlzIHBhY2thZ2Ugc28gaG9wZSBmb3IgdGhlIGJlc3QgOlBcbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZVxuY29uc3QgeyBGdW5jdGlvblRyYW5zZm9ybWVyIH0gPSByZXF1aXJlKCdncmFwaHFsLWZ1bmN0aW9uLXRyYW5zZm9ybWVyJyk7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2NoZW1hVHJhbnNmb3JtZXJQcm9wcyB7XG4gIC8qKlxuICAgKiBGaWxlIHBhdGggdG8gdGhlIGdyYXBocWwgc2NoZW1hXG4gICAqIEBkZWZhdWx0IHNjaGVtYS5ncmFwaHFsXG4gICAqL1xuICByZWFkb25seSBzY2hlbWFQYXRoPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBQYXRoIHdoZXJlIHRyYW5zZm9ybWVkIHNjaGVtYSBhbmQgcmVzb2x2ZXJzIHdpbGwgYmUgcGxhY2VkXG4gICAqIEBkZWZhdWx0IGFwcHN5bmNcbiAgICovXG4gIHJlYWRvbmx5IG91dHB1dFBhdGg/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFNldCBkZWxldGlvbiBwcm90ZWN0aW9uIG9uIER5bmFtb0RCIHRhYmxlc1xuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICByZWFkb25seSBkZWxldGlvblByb3RlY3Rpb25FbmFibGVkPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogV2hldGhlciB0byBlbmFibGUgRGF0YVN0b3JlIG9yIG5vdFxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgcmVhZG9ubHkgc3luY0VuYWJsZWQ/OiBib29sZWFuO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFNjaGVtYVRyYW5zZm9ybWVyT3V0cHV0cyB7XG4gIHJlYWRvbmx5IGNka1RhYmxlcz86IHsgW25hbWU6IHN0cmluZ106IENka1RyYW5zZm9ybWVyVGFibGUgfTtcbiAgcmVhZG9ubHkgbm9uZVJlc29sdmVycz86IHsgW25hbWU6IHN0cmluZ106IENka1RyYW5zZm9ybWVyUmVzb2x2ZXIgfTtcbiAgcmVhZG9ubHkgZnVuY3Rpb25SZXNvbHZlcnM/OiB7IFtuYW1lOiBzdHJpbmddOiBDZGtUcmFuc2Zvcm1lckZ1bmN0aW9uUmVzb2x2ZXJbXSB9O1xuICByZWFkb25seSBodHRwUmVzb2x2ZXJzPzogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJIdHRwUmVzb2x2ZXJbXSB9O1xuICByZWFkb25seSBxdWVyaWVzPzogeyBbbmFtZTogc3RyaW5nXTogc3RyaW5nIH07XG4gIHJlYWRvbmx5IG11dGF0aW9ucz86IHsgW25hbWU6IHN0cmluZ106IENka1RyYW5zZm9ybWVyUmVzb2x2ZXIgfTtcbiAgcmVhZG9ubHkgc3Vic2NyaXB0aW9ucz86IHsgW25hbWU6IHN0cmluZ106IENka1RyYW5zZm9ybWVyUmVzb2x2ZXIgfTtcbn1cblxuZXhwb3J0IGNsYXNzIFNjaGVtYVRyYW5zZm9ybWVyIHtcbiAgcHVibGljIHJlYWRvbmx5IHNjaGVtYVBhdGg6IHN0cmluZ1xuICBwdWJsaWMgcmVhZG9ubHkgb3V0cHV0UGF0aDogc3RyaW5nXG4gIHB1YmxpYyByZWFkb25seSBpc1N5bmNFbmFibGVkOiBib29sZWFuXG5cbiAgcHJpdmF0ZSByZWFkb25seSBhdXRoVHJhbnNmb3JtZXJDb25maWc6IE1vZGVsQXV0aFRyYW5zZm9ybWVyQ29uZmlnXG5cbiAgb3V0cHV0czogU2NoZW1hVHJhbnNmb3JtZXJPdXRwdXRzXG4gIHJlc29sdmVyczogYW55XG4gIGF1dGhSb2xlUG9saWN5OiBSZXNvdXJjZSB8IHVuZGVmaW5lZFxuICB1bmF1dGhSb2xlUG9saWN5OiBSZXNvdXJjZSB8IHVuZGVmaW5lZFxuXG4gIGNvbnN0cnVjdG9yKHByb3BzOiBTY2hlbWFUcmFuc2Zvcm1lclByb3BzKSB7XG4gICAgdGhpcy5zY2hlbWFQYXRoID0gcHJvcHMuc2NoZW1hUGF0aCB8fCAnLi9zY2hlbWEuZ3JhcGhxbCc7XG4gICAgdGhpcy5vdXRwdXRQYXRoID0gcHJvcHMub3V0cHV0UGF0aCB8fCAnLi9hcHBzeW5jJztcbiAgICB0aGlzLmlzU3luY0VuYWJsZWQgPSBwcm9wcy5zeW5jRW5hYmxlZCB8fCBmYWxzZTtcblxuICAgIHRoaXMub3V0cHV0cyA9IHt9O1xuICAgIHRoaXMucmVzb2x2ZXJzID0ge307XG5cbiAgICAvLyBUT0RPOiBNYWtlIHRoaXMgYmV0dGVyP1xuICAgIHRoaXMuYXV0aFRyYW5zZm9ybWVyQ29uZmlnID0ge1xuICAgICAgYXV0aENvbmZpZzoge1xuICAgICAgICBkZWZhdWx0QXV0aGVudGljYXRpb246IHtcbiAgICAgICAgICBhdXRoZW50aWNhdGlvblR5cGU6ICdBTUFaT05fQ09HTklUT19VU0VSX1BPT0xTJyxcbiAgICAgICAgICB1c2VyUG9vbENvbmZpZzoge1xuICAgICAgICAgICAgdXNlclBvb2xJZDogJzEyMzQ1eHl6JyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBhZGRpdGlvbmFsQXV0aGVudGljYXRpb25Qcm92aWRlcnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBhdXRoZW50aWNhdGlvblR5cGU6ICdBUElfS0VZJyxcbiAgICAgICAgICAgIGFwaUtleUNvbmZpZzoge1xuICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogJ1Rlc3RpbmcnLFxuICAgICAgICAgICAgICBhcGlLZXlFeHBpcmF0aW9uRGF5czogMTAwLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGF1dGhlbnRpY2F0aW9uVHlwZTogJ0FXU19JQU0nLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgYXV0aGVudGljYXRpb25UeXBlOiAnT1BFTklEX0NPTk5FQ1QnLFxuICAgICAgICAgICAgb3BlbklEQ29ubmVjdENvbmZpZzoge1xuICAgICAgICAgICAgICBuYW1lOiAnT0lEQycsXG4gICAgICAgICAgICAgIGlzc3VlclVybDogJ2h0dHBzOi8vY29nbml0by1pZHAudXMtZWFzdC0xLmFtYXpvbmF3cy5jb20vdXMtZWFzdC0xX1hYWCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBwdWJsaWMgdHJhbnNmb3JtKHByZUNka1RyYW5zZm9ybWVyczogSVRyYW5zZm9ybWVyW10gPSBbXSwgcG9zdENka1RyYW5zZm9ybWVyczogSVRyYW5zZm9ybWVyW10gPSBbXSkge1xuICAgIGNvbnN0IHRyYW5zZm9ybUNvbmZpZyA9IHRoaXMuaXNTeW5jRW5hYmxlZCA/IHRoaXMubG9hZENvbmZpZ1N5bmMoKSA6IHt9O1xuXG4gICAgLy8gTm90ZTogVGhpcyBpcyBub3QgZXhhY3QgYXMgd2UgYXJlIG9taXR0aW5nIHRoZSBAc2VhcmNoYWJsZSB0cmFuc2Zvcm1lciBhcyB3ZWxsIGFzIHNvbWUgb3RoZXJzLlxuICAgIGNvbnN0IHRyYW5zZm9ybWVyID0gbmV3IEdyYXBoUUxUcmFuc2Zvcm0oe1xuICAgICAgdHJhbnNmb3JtQ29uZmlnOiB0cmFuc2Zvcm1Db25maWcsXG4gICAgICB0cmFuc2Zvcm1lcnM6IFtcbiAgICAgICAgbmV3IER5bmFtb0RCTW9kZWxUcmFuc2Zvcm1lcigpLFxuICAgICAgICBuZXcgVHRsVHJhbnNmb3JtZXIoKSxcbiAgICAgICAgbmV3IFZlcnNpb25lZE1vZGVsVHJhbnNmb3JtZXIoKSxcbiAgICAgICAgbmV3IEZ1bmN0aW9uVHJhbnNmb3JtZXIoKSxcbiAgICAgICAgbmV3IEtleVRyYW5zZm9ybWVyKCksXG4gICAgICAgIG5ldyBNb2RlbENvbm5lY3Rpb25UcmFuc2Zvcm1lcigpLFxuICAgICAgICBuZXcgTW9kZWxBdXRoVHJhbnNmb3JtZXIodGhpcy5hdXRoVHJhbnNmb3JtZXJDb25maWcpLFxuICAgICAgICBuZXcgSHR0cFRyYW5zZm9ybWVyKCksXG4gICAgICAgIC4uLnByZUNka1RyYW5zZm9ybWVycyxcbiAgICAgICAgbmV3IENka1RyYW5zZm9ybWVyKCksXG4gICAgICAgIC4uLnBvc3RDZGtUcmFuc2Zvcm1lcnMsXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgY29uc3Qgc2NoZW1hID0gZnMucmVhZEZpbGVTeW5jKHRoaXMuc2NoZW1hUGF0aCk7XG4gICAgY29uc3QgY2Zkb2MgPSB0cmFuc2Zvcm1lci50cmFuc2Zvcm0oc2NoZW1hLnRvU3RyaW5nKCkpO1xuXG4gICAgLy8gVE9ETzogR2V0IFVuYXV0aCBSb2xlIGFuZCBBdXRoIFJvbGUgcG9saWNpZXMgZm9yIGF1dGhvcml6YXRpb24gc3R1ZmZcbiAgICB0aGlzLnVuYXV0aFJvbGVQb2xpY3kgPSBjZmRvYy5yb290U3RhY2suUmVzb3VyY2VzPy5VbmF1dGhSb2xlUG9saWN5MDEgYXMgUmVzb3VyY2UgfHwgdW5kZWZpbmVkO1xuICAgIHRoaXMuYXV0aFJvbGVQb2xpY3kgPSBjZmRvYy5yb290U3RhY2suUmVzb3VyY2VzPy5BdXRoUm9sZVBvbGljeTAxIGFzIFJlc291cmNlIHx8IHVuZGVmaW5lZDtcblxuICAgIHRoaXMud3JpdGVTY2hlbWEoY2Zkb2Muc2NoZW1hKTtcbiAgICB0aGlzLndyaXRlUmVzb2x2ZXJzVG9GaWxlKGNmZG9jLnJlc29sdmVycyk7XG5cbiAgICAvLyBPdXRwdXRzIHNob3VsZG4ndCBiZSBudWxsIGJ1dCBkZWZhdWx0IHRvIGVtcHR5IG1hcFxuICAgIHRoaXMub3V0cHV0cyA9IGNmZG9jLnJvb3RTdGFjay5PdXRwdXRzID8/IHt9O1xuXG4gICAgcmV0dXJuIHRoaXMub3V0cHV0cztcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXRzIHRoZSByZXNvbHZlcnMgZnJvbSB0aGUgYC4vYXBwc3luYy9yZXNvbHZlcnNgIGZvbGRlclxuICAgKiBAcmV0dXJucyBhbGwgcmVzb2x2ZXJzXG4gICAqL1xuICBwdWJsaWMgZ2V0UmVzb2x2ZXJzKCkge1xuICAgIGNvbnN0IHN0YXRlbWVudHMgPSBbJ1F1ZXJ5JywgJ011dGF0aW9uJ107XG4gICAgY29uc3QgcmVzb2x2ZXJzRGlyUGF0aCA9IG5vcm1hbGl6ZSgnLi9hcHBzeW5jL3Jlc29sdmVycycpO1xuICAgIGlmIChmcy5leGlzdHNTeW5jKHJlc29sdmVyc0RpclBhdGgpKSB7XG4gICAgICBjb25zdCBmaWxlcyA9IGZzLnJlYWRkaXJTeW5jKHJlc29sdmVyc0RpclBhdGgpO1xuICAgICAgZmlsZXMuZm9yRWFjaChmaWxlID0+IHtcbiAgICAgICAgLy8gRXhhbXBsZTogTXV0YXRpb24uY3JlYXRlQ2hhbm5lbC5yZXNwb25zZVxuICAgICAgICBsZXQgYXJncyA9IGZpbGUuc3BsaXQoJy4nKTtcbiAgICAgICAgbGV0IHR5cGVOYW1lOiBzdHJpbmcgPSBhcmdzWzBdO1xuICAgICAgICBsZXQgZmllbGROYW1lOiBzdHJpbmcgPSBhcmdzWzFdO1xuICAgICAgICBsZXQgdGVtcGxhdGVUeXBlID0gYXJnc1syXTsgLy8gcmVxdWVzdCBvciByZXNwb25zZVxuXG4gICAgICAgIC8vIGRlZmF1bHQgdG8gY29tcG9zaXRlIGtleSBvZiB0eXBlTmFtZSBhbmQgZmllbGROYW1lLCBob3dldmVyIGlmIGl0XG4gICAgICAgIC8vIGlzIFF1ZXJ5LCBNdXRhdGlvbiBvciBTdWJzY3JpcHRpb24gKHRvcCBsZXZlbCkgdGhlIGNvbXBvc2l0ZUtleSBpcyB0aGVcbiAgICAgICAgLy8gc2FtZSBhcyBmaWVsZE5hbWUgb25seVxuICAgICAgICBsZXQgY29tcG9zaXRlS2V5ID0gYCR7dHlwZU5hbWV9JHtmaWVsZE5hbWV9YDtcbiAgICAgICAgaWYgKHN0YXRlbWVudHMuaW5kZXhPZih0eXBlTmFtZSkgPj0gMCkge1xuICAgICAgICAgIGlmICghdGhpcy5vdXRwdXRzLm5vbmVSZXNvbHZlcnMgfHwgIXRoaXMub3V0cHV0cy5ub25lUmVzb2x2ZXJzW2NvbXBvc2l0ZUtleV0pIGNvbXBvc2l0ZUtleSA9IGZpZWxkTmFtZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBmaWxlcGF0aCA9IG5vcm1hbGl6ZShgJHtyZXNvbHZlcnNEaXJQYXRofS8ke2ZpbGV9YCk7XG5cbiAgICAgICAgaWYgKHN0YXRlbWVudHMuaW5kZXhPZih0eXBlTmFtZSkgPj0gMCB8fCAodGhpcy5vdXRwdXRzLm5vbmVSZXNvbHZlcnMgJiYgdGhpcy5vdXRwdXRzLm5vbmVSZXNvbHZlcnNbY29tcG9zaXRlS2V5XSkpIHtcbiAgICAgICAgICBpZiAoIXRoaXMucmVzb2x2ZXJzW2NvbXBvc2l0ZUtleV0pIHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZXJzW2NvbXBvc2l0ZUtleV0gPSB7XG4gICAgICAgICAgICAgIHR5cGVOYW1lOiB0eXBlTmFtZSxcbiAgICAgICAgICAgICAgZmllbGROYW1lOiBmaWVsZE5hbWUsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh0ZW1wbGF0ZVR5cGUgPT09ICdyZXEnKSB7XG4gICAgICAgICAgICB0aGlzLnJlc29sdmVyc1tjb21wb3NpdGVLZXldLnJlcXVlc3RNYXBwaW5nVGVtcGxhdGUgPSBmaWxlcGF0aDtcbiAgICAgICAgICB9IGVsc2UgaWYgKHRlbXBsYXRlVHlwZSA9PT0gJ3JlcycpIHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZXJzW2NvbXBvc2l0ZUtleV0ucmVzcG9uc2VNYXBwaW5nVGVtcGxhdGUgPSBmaWxlcGF0aDtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5pc0h0dHBSZXNvbHZlcih0eXBlTmFtZSwgZmllbGROYW1lKSkge1xuICAgICAgICAgIGlmICghdGhpcy5yZXNvbHZlcnNbY29tcG9zaXRlS2V5XSkge1xuICAgICAgICAgICAgdGhpcy5yZXNvbHZlcnNbY29tcG9zaXRlS2V5XSA9IHtcbiAgICAgICAgICAgICAgdHlwZU5hbWU6IHR5cGVOYW1lLFxuICAgICAgICAgICAgICBmaWVsZE5hbWU6IGZpZWxkTmFtZSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHRlbXBsYXRlVHlwZSA9PT0gJ3JlcScpIHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZXJzW2NvbXBvc2l0ZUtleV0ucmVxdWVzdE1hcHBpbmdUZW1wbGF0ZSA9IGZpbGVwYXRoO1xuICAgICAgICAgIH0gZWxzZSBpZiAodGVtcGxhdGVUeXBlID09PSAncmVzJykge1xuICAgICAgICAgICAgdGhpcy5yZXNvbHZlcnNbY29tcG9zaXRlS2V5XS5yZXNwb25zZU1hcHBpbmdUZW1wbGF0ZSA9IGZpbGVwYXRoO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHsgLy8gVGhpcyBpcyBhIEdTSVxuICAgICAgICAgIGlmICghdGhpcy5yZXNvbHZlcnMuZ3NpKSB7XG4gICAgICAgICAgICB0aGlzLnJlc29sdmVycy5nc2kgPSB7fTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKCF0aGlzLnJlc29sdmVycy5nc2lbY29tcG9zaXRlS2V5XSkge1xuICAgICAgICAgICAgdGhpcy5yZXNvbHZlcnMuZ3NpW2NvbXBvc2l0ZUtleV0gPSB7XG4gICAgICAgICAgICAgIHR5cGVOYW1lOiB0eXBlTmFtZSxcbiAgICAgICAgICAgICAgZmllbGROYW1lOiBmaWVsZE5hbWUsXG4gICAgICAgICAgICAgIHRhYmxlTmFtZTogZmllbGROYW1lLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgZmllbGROYW1lLnNsaWNlKDEpLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAodGVtcGxhdGVUeXBlID09PSAncmVxJykge1xuICAgICAgICAgICAgdGhpcy5yZXNvbHZlcnMuZ3NpW2NvbXBvc2l0ZUtleV0ucmVxdWVzdE1hcHBpbmdUZW1wbGF0ZSA9IGZpbGVwYXRoO1xuICAgICAgICAgIH0gZWxzZSBpZiAodGVtcGxhdGVUeXBlID09PSAncmVzJykge1xuICAgICAgICAgICAgdGhpcy5yZXNvbHZlcnMuZ3NpW2NvbXBvc2l0ZUtleV0ucmVzcG9uc2VNYXBwaW5nVGVtcGxhdGUgPSBmaWxlcGF0aDtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnJlc29sdmVycztcbiAgfVxuXG4gIC8qKlxuICAgKiBkZWNpZGVzIGlmIHRoaXMgaXMgYSByZXNvbHZlciBmb3IgYW4gSFRUUCBkYXRhc291cmNlXG4gICAqIEBwYXJhbSB0eXBlTmFtZVxuICAgKiBAcGFyYW0gZmllbGROYW1lXG4gICAqL1xuXG4gIHByaXZhdGUgaXNIdHRwUmVzb2x2ZXIodHlwZU5hbWU6IHN0cmluZywgZmllbGROYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAoIXRoaXMub3V0cHV0cy5odHRwUmVzb2x2ZXJzKSByZXR1cm4gZmFsc2U7XG5cbiAgICBmb3IgKGNvbnN0IGVuZHBvaW50IGluIHRoaXMub3V0cHV0cy5odHRwUmVzb2x2ZXJzKSB7XG4gICAgICBmb3IgKGNvbnN0IHJlc29sdmVyIG9mIHRoaXMub3V0cHV0cy5odHRwUmVzb2x2ZXJzW2VuZHBvaW50XSkge1xuICAgICAgICBpZiAocmVzb2x2ZXIudHlwZU5hbWUgPT09IHR5cGVOYW1lICYmIHJlc29sdmVyLmZpZWxkTmFtZSA9PT0gZmllbGROYW1lKSByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvKipcbiAgICAgKiBXcml0ZXMgdGhlIHNjaGVtYSB0byB0aGUgb3V0cHV0IGRpcmVjdG9yeSBmb3IgdXNlIHdpdGggQGF3cy1jZGsvYXdzLWFwcHN5bmNcbiAgICAgKiBAcGFyYW0gc2NoZW1hXG4gICAgICovXG4gIHByaXZhdGUgd3JpdGVTY2hlbWEoc2NoZW1hOiBhbnkpIHtcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmModGhpcy5vdXRwdXRQYXRoKSkge1xuICAgICAgZnMubWtkaXJTeW5jKHRoaXMub3V0cHV0UGF0aCk7XG4gICAgfVxuXG4gICAgZnMud3JpdGVGaWxlU3luYyhgJHt0aGlzLm91dHB1dFBhdGh9L3NjaGVtYS5ncmFwaHFsYCwgc2NoZW1hKTtcbiAgfVxuXG4gIC8qKlxuICAgICAqIFdyaXRlcyBhbGwgdGhlIHJlc29sdmVycyB0byB0aGUgb3V0cHV0IGRpcmVjdG9yeSBmb3IgbG9hZGluZyBpbnRvIHRoZSBkYXRhc291cmNlcyBsYXRlclxuICAgICAqIEBwYXJhbSByZXNvbHZlcnNcbiAgICAgKi9cbiAgcHJpdmF0ZSB3cml0ZVJlc29sdmVyc1RvRmlsZShyZXNvbHZlcnM6IGFueSkge1xuICAgIGlmICghZnMuZXhpc3RzU3luYyh0aGlzLm91dHB1dFBhdGgpKSB7XG4gICAgICBmcy5ta2RpclN5bmModGhpcy5vdXRwdXRQYXRoKTtcbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlckZvbGRlclBhdGggPSBub3JtYWxpemUodGhpcy5vdXRwdXRQYXRoICsgJy9yZXNvbHZlcnMnKTtcbiAgICBpZiAoZnMuZXhpc3RzU3luYyhyZXNvbHZlckZvbGRlclBhdGgpKSB7XG4gICAgICBjb25zdCBmaWxlcyA9IGZzLnJlYWRkaXJTeW5jKHJlc29sdmVyRm9sZGVyUGF0aCk7XG4gICAgICBmaWxlcy5mb3JFYWNoKGZpbGUgPT4gZnMudW5saW5rU3luYyhyZXNvbHZlckZvbGRlclBhdGggKyAnLycgKyBmaWxlKSk7XG4gICAgICBmcy5ybWRpclN5bmMocmVzb2x2ZXJGb2xkZXJQYXRoKTtcbiAgICB9XG5cbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMocmVzb2x2ZXJGb2xkZXJQYXRoKSkge1xuICAgICAgZnMubWtkaXJTeW5jKHJlc29sdmVyRm9sZGVyUGF0aCk7XG4gICAgfVxuXG4gICAgT2JqZWN0LmtleXMocmVzb2x2ZXJzKS5mb3JFYWNoKChrZXk6IGFueSkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZXIgPSByZXNvbHZlcnNba2V5XTtcbiAgICAgIGNvbnN0IGZpbGVOYW1lID0ga2V5LnJlcGxhY2UoJy52dGwnLCAnJyk7XG4gICAgICBjb25zdCByZXNvbHZlckZpbGVQYXRoID0gbm9ybWFsaXplKGAke3Jlc29sdmVyRm9sZGVyUGF0aH0vJHtmaWxlTmFtZX1gKTtcbiAgICAgIGZzLndyaXRlRmlsZVN5bmMocmVzb2x2ZXJGaWxlUGF0aCwgcmVzb2x2ZXIpO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAgICogQHJldHVybnMge0BsaW5rIFRyYW5zZm9ybUNvbmZpZ31cbiAgICAqL1xuICBwcml2YXRlIGxvYWRDb25maWdTeW5jKHByb2plY3REaXI6IHN0cmluZyA9ICdyZXNvdXJjZXMnKTogVHJhbnNmb3JtQ29uZmlnIHtcbiAgICAvLyBJbml0aWFsaXplIHRoZSBjb25maWcgYWx3YXlzIHdpdGggdGhlIGxhdGVzdCB2ZXJzaW9uLCBvdGhlciBtZW1iZXJzIGFyZSBvcHRpb25hbCBmb3Igbm93LlxuICAgIGxldCBjb25maWc6IFRyYW5zZm9ybUNvbmZpZyA9IHtcbiAgICAgIFZlcnNpb246IFRSQU5TRk9STV9DVVJSRU5UX1ZFUlNJT04sXG4gICAgICBSZXNvbHZlckNvbmZpZzoge1xuICAgICAgICBwcm9qZWN0OiB7XG4gICAgICAgICAgQ29uZmxpY3RIYW5kbGVyOiBDb25mbGljdEhhbmRsZXJUeXBlLk9QVElNSVNUSUMsXG4gICAgICAgICAgQ29uZmxpY3REZXRlY3Rpb246ICdWRVJTSU9OJyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIGNvbnN0IGNvbmZpZ0RpciA9IGpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLi4nLCBwcm9qZWN0RGlyKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjb25maWdQYXRoID0gam9pbihjb25maWdEaXIsIFRSQU5TRk9STV9DT05GSUdfRklMRV9OQU1FKTtcbiAgICAgIGNvbnN0IGNvbmZpZ0V4aXN0cyA9IGZzLmV4aXN0c1N5bmMoY29uZmlnUGF0aCk7XG4gICAgICBpZiAoY29uZmlnRXhpc3RzKSB7XG4gICAgICAgIGNvbnN0IGNvbmZpZ1N0ciA9IGZzLnJlYWRGaWxlU3luYyhjb25maWdQYXRoKTtcbiAgICAgICAgY29uZmlnID0gSlNPTi5wYXJzZShjb25maWdTdHIudG9TdHJpbmcoKSk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjb25maWcgYXMgVHJhbnNmb3JtQ29uZmlnO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgcmV0dXJuIGNvbmZpZztcbiAgICB9XG4gIH1cbn1cbiJdfQ==