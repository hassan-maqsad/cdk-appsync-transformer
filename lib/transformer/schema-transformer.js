"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransformerFeatureFlagProvider = exports.SchemaTransformer = void 0;
const fs = require("fs");
const path = require("path");
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
        const resolversDirPath = path.normalize(path.join(this.outputPath, 'resolvers'));
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
                let filepath = path.normalize(path.join(resolversDirPath, file));
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
            fs.mkdirSync(this.outputPath, { recursive: true });
        }
        fs.writeFileSync(`${this.outputPath}/schema.graphql`, schema);
    }
    /**
       * Writes all the resolvers to the output directory for loading into the datasources later
       * @param resolvers
       */
    writeResolversToFile(resolvers) {
        if (!fs.existsSync(this.outputPath)) {
            fs.mkdirSync(this.outputPath, { recursive: true });
        }
        const resolverFolderPath = path.normalize(path.join(this.outputPath, 'resolvers'));
        if (fs.existsSync(resolverFolderPath)) {
            const files = fs.readdirSync(resolverFolderPath);
            files.forEach(file => fs.unlinkSync(resolverFolderPath + '/' + file));
            fs.rmdirSync(resolverFolderPath);
        }
        if (!fs.existsSync(resolverFolderPath)) {
            fs.mkdirSync(resolverFolderPath, { recursive: true });
        }
        Object.keys(resolvers).forEach((key) => {
            const resolver = resolvers[key];
            const fileName = key.replace('.vtl', '');
            const resolverFilePath = path.normalize(path.join(resolverFolderPath, fileName));
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
        const configDir = path.join(__dirname, '..', '..', projectDir);
        try {
            const configPath = path.join(configDir, graphql_transformer_core_1.TRANSFORM_CONFIG_FILE_NAME);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NoZW1hLXRyYW5zZm9ybWVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3RyYW5zZm9ybWVyL3NjaGVtYS10cmFuc2Zvcm1lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSx5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLHVFQUE0RjtBQUM1RixtRkFBNEU7QUFDNUUsK0VBQXdFO0FBQ3hFLHVFQUEyRDtBQUMzRCxxRUFBeUQ7QUFDekQsdUVBUWtDO0FBQ2xDLHFFQUFxRDtBQUNyRCxpRkFBMEU7QUFFMUUsdURBTTJCO0FBQzNCLHFFQUFnRTtBQUtoRSx5SUFBeUk7QUFDekksMkJBQTJCO0FBQzNCLE1BQU0sRUFBRSxtQkFBbUIsRUFBRSxHQUFHLE9BQU8sQ0FBQyw4QkFBOEIsQ0FBQyxDQUFDO0FBNEN4RSxNQUFhLGlCQUFpQjtJQWE1QixZQUFZLEtBQTZCOztRQUN2QyxJQUFJLENBQUMsVUFBVSxTQUFHLEtBQUssQ0FBQyxVQUFVLG1DQUFJLGtCQUFrQixDQUFDO1FBQ3pELElBQUksQ0FBQyxVQUFVLFNBQUcsS0FBSyxDQUFDLFVBQVUsbUNBQUksV0FBVyxDQUFDO1FBQ2xELElBQUksQ0FBQyxhQUFhLFNBQUcsS0FBSyxDQUFDLFdBQVcsbUNBQUksS0FBSyxDQUFDO1FBQ2hELElBQUksQ0FBQyxpQ0FBaUMsU0FBRyxLQUFLLENBQUMsaUNBQWlDLG1DQUFJLE9BQU8sQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUVsRyxJQUFJLENBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztRQUNsQixJQUFJLENBQUMsU0FBUyxHQUFHLEVBQUUsQ0FBQztRQUVwQiwwQkFBMEI7UUFDMUIsSUFBSSxDQUFDLHFCQUFxQixHQUFHO1lBQzNCLFVBQVUsRUFBRTtnQkFDVixxQkFBcUIsRUFBRTtvQkFDckIsa0JBQWtCLEVBQUUsMkJBQTJCO29CQUMvQyxjQUFjLEVBQUU7d0JBQ2QsVUFBVSxFQUFFLFVBQVU7cUJBQ3ZCO2lCQUNGO2dCQUNE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QUFDO1NBQ2Y7SUFDSCxDQUFDO0NBQ0Y7QUFuUUQsOENBbVFDO0FBR0Q7OztHQUdHO0FBQ0gsTUFBYSw4QkFBOEI7SUFDekMsVUFBVSxDQUFDLFdBQW1CLEVBQUUsT0FBaUI7UUFDL0MsUUFBUSxXQUFXLEVBQUU7WUFDbkIsS0FBSyxzQkFBc0I7Z0JBQ3pCLE9BQU8sSUFBSSxDQUFDO1lBQ2QsS0FBSywrQkFBK0I7Z0JBQ2xDLE9BQU8sS0FBSyxDQUFDO1lBQ2Y7Z0JBQ0UsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFVLFdBQVcsRUFBRSxPQUFPLENBQUMsQ0FBQztTQUN2RDtJQUNILENBQUM7SUFDRCxTQUFTLENBQUMsV0FBbUIsRUFBRSxPQUFnQjtRQUM3QyxPQUFPLElBQUksQ0FBQyxRQUFRLENBQVMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ3JELENBQUM7SUFDRCxTQUFTLENBQUMsV0FBbUIsRUFBRSxPQUFnQjtRQUM3QyxPQUFPLElBQUksQ0FBQyxRQUFRLENBQVMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQ3JELENBQUM7SUFDRCxTQUFTO1FBQ1AsaUNBQWlDO1FBQ2pDLE1BQU0sSUFBSSxLQUFLLENBQUMsaUJBQWlCLENBQUMsQ0FBQztJQUNyQyxDQUFDO0lBRVMsUUFBUSxDQUFzQyxXQUFtQixFQUFFLFlBQWdCO1FBQzNGLElBQUksWUFBWSxLQUFLLFNBQVMsRUFBRTtZQUM5QixPQUFPLFlBQVksQ0FBQztTQUNyQjtRQUNELE1BQU0sSUFBSSxLQUFLLENBQUMsOEJBQThCLFdBQVcsRUFBRSxDQUFDLENBQUM7SUFDL0QsQ0FBQztDQUNGO0FBNUJELHdFQTRCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBNb2RlbEF1dGhUcmFuc2Zvcm1lciwgTW9kZWxBdXRoVHJhbnNmb3JtZXJDb25maWcgfSBmcm9tICdncmFwaHFsLWF1dGgtdHJhbnNmb3JtZXInO1xuaW1wb3J0IHsgTW9kZWxDb25uZWN0aW9uVHJhbnNmb3JtZXIgfSBmcm9tICdncmFwaHFsLWNvbm5lY3Rpb24tdHJhbnNmb3JtZXInO1xuaW1wb3J0IHsgRHluYW1vREJNb2RlbFRyYW5zZm9ybWVyIH0gZnJvbSAnZ3JhcGhxbC1keW5hbW9kYi10cmFuc2Zvcm1lcic7XG5pbXBvcnQgeyBIdHRwVHJhbnNmb3JtZXIgfSBmcm9tICdncmFwaHFsLWh0dHAtdHJhbnNmb3JtZXInO1xuaW1wb3J0IHsgS2V5VHJhbnNmb3JtZXIgfSBmcm9tICdncmFwaHFsLWtleS10cmFuc2Zvcm1lcic7XG5pbXBvcnQge1xuICBHcmFwaFFMVHJhbnNmb3JtLFxuICBUcmFuc2Zvcm1Db25maWcsXG4gIFRSQU5TRk9STV9DVVJSRU5UX1ZFUlNJT04sXG4gIFRSQU5TRk9STV9DT05GSUdfRklMRV9OQU1FLFxuICBDb25mbGljdEhhbmRsZXJUeXBlLFxuICBJVHJhbnNmb3JtZXIsXG4gIEZlYXR1cmVGbGFnUHJvdmlkZXIsXG59IGZyb20gJ2dyYXBocWwtdHJhbnNmb3JtZXItY29yZSc7XG5pbXBvcnQgVHRsVHJhbnNmb3JtZXIgZnJvbSAnZ3JhcGhxbC10dGwtdHJhbnNmb3JtZXInO1xuaW1wb3J0IHsgVmVyc2lvbmVkTW9kZWxUcmFuc2Zvcm1lciB9IGZyb20gJ2dyYXBocWwtdmVyc2lvbmVkLXRyYW5zZm9ybWVyJztcblxuaW1wb3J0IHtcbiAgQ2RrVHJhbnNmb3JtZXIsXG4gIENka1RyYW5zZm9ybWVyVGFibGUsXG4gIENka1RyYW5zZm9ybWVyUmVzb2x2ZXIsXG4gIENka1RyYW5zZm9ybWVyRnVuY3Rpb25SZXNvbHZlcixcbiAgQ2RrVHJhbnNmb3JtZXJIdHRwUmVzb2x2ZXIsXG59IGZyb20gJy4vY2RrLXRyYW5zZm9ybWVyJztcbmltcG9ydCB7IEN1c3RvbVZUTFRyYW5zZm9ybWVyIH0gZnJvbSAnLi9jdXN0b20tdnRsLXRyYW5zZm9ybWVyJztcblxuLy8gUmVidWlsdCB0aGlzIGZyb20gY2xvdWRmb3JtLXR5cGVzIGJlY2F1c2UgaXQgaGFzIHR5cGUgZXJyb3JzXG5pbXBvcnQgeyBSZXNvdXJjZSB9IGZyb20gJy4vcmVzb3VyY2UnO1xuXG4vLyBJbXBvcnQgdGhpcyB3YXkgYmVjYXVzZSBGdW5jdGlvblRyYW5zZm9ybWVyLmQudHMgdHlwZXMgd2VyZSB0aHJvd2luZyBhbiBlcm9yLiBBbmQgd2UgZGlkbid0IHdyaXRlIHRoaXMgcGFja2FnZSBzbyBob3BlIGZvciB0aGUgYmVzdCA6UFxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lXG5jb25zdCB7IEZ1bmN0aW9uVHJhbnNmb3JtZXIgfSA9IHJlcXVpcmUoJ2dyYXBocWwtZnVuY3Rpb24tdHJhbnNmb3JtZXInKTtcblxuZXhwb3J0IGludGVyZmFjZSBTY2hlbWFUcmFuc2Zvcm1lclByb3BzIHtcbiAgLyoqXG4gICAqIEZpbGUgcGF0aCB0byB0aGUgZ3JhcGhxbCBzY2hlbWFcbiAgICogQGRlZmF1bHQgc2NoZW1hLmdyYXBocWxcbiAgICovXG4gIHJlYWRvbmx5IHNjaGVtYVBhdGg/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFBhdGggd2hlcmUgdHJhbnNmb3JtZWQgc2NoZW1hIGFuZCByZXNvbHZlcnMgd2lsbCBiZSBwbGFjZWRcbiAgICogQGRlZmF1bHQgYXBwc3luY1xuICAgKi9cbiAgcmVhZG9ubHkgb3V0cHV0UGF0aD86IHN0cmluZztcblxuICAvKipcbiAgICogU2V0IGRlbGV0aW9uIHByb3RlY3Rpb24gb24gRHluYW1vREIgdGFibGVzXG4gICAqIEBkZWZhdWx0IHRydWVcbiAgICovXG4gIHJlYWRvbmx5IGRlbGV0aW9uUHJvdGVjdGlvbkVuYWJsZWQ/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRvIGVuYWJsZSBEYXRhU3RvcmUgb3Igbm90XG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICByZWFkb25seSBzeW5jRW5hYmxlZD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFRoZSByb290IGRpcmVjdG9yeSB0byB1c2UgZm9yIGZpbmRpbmcgY3VzdG9tIHJlc29sdmVyc1xuICAgKiBAZGVmYXVsdCBwcm9jZXNzLmN3ZCgpXG4gICAqL1xuICByZWFkb25seSBjdXN0b21WdGxUcmFuc2Zvcm1lclJvb3REaXJlY3Rvcnk/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2NoZW1hVHJhbnNmb3JtZXJPdXRwdXRzIHtcbiAgcmVhZG9ubHkgY2RrVGFibGVzPzogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJUYWJsZSB9O1xuICByZWFkb25seSBub25lUmVzb2x2ZXJzPzogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJSZXNvbHZlciB9O1xuICByZWFkb25seSBmdW5jdGlvblJlc29sdmVycz86IHsgW25hbWU6IHN0cmluZ106IENka1RyYW5zZm9ybWVyRnVuY3Rpb25SZXNvbHZlcltdIH07XG4gIHJlYWRvbmx5IGh0dHBSZXNvbHZlcnM/OiB7IFtuYW1lOiBzdHJpbmddOiBDZGtUcmFuc2Zvcm1lckh0dHBSZXNvbHZlcltdIH07XG4gIHJlYWRvbmx5IHF1ZXJpZXM/OiB7IFtuYW1lOiBzdHJpbmddOiBzdHJpbmcgfTtcbiAgcmVhZG9ubHkgbXV0YXRpb25zPzogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJSZXNvbHZlciB9O1xuICByZWFkb25seSBzdWJzY3JpcHRpb25zPzogeyBbbmFtZTogc3RyaW5nXTogQ2RrVHJhbnNmb3JtZXJSZXNvbHZlciB9O1xufVxuXG5leHBvcnQgY2xhc3MgU2NoZW1hVHJhbnNmb3JtZXIge1xuICBwdWJsaWMgcmVhZG9ubHkgc2NoZW1hUGF0aDogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgb3V0cHV0UGF0aDogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgaXNTeW5jRW5hYmxlZDogYm9vbGVhbjtcbiAgcHVibGljIHJlYWRvbmx5IGN1c3RvbVZ0bFRyYW5zZm9ybWVyUm9vdERpcmVjdG9yeTogc3RyaW5nO1xuXG4gIHByaXZhdGUgcmVhZG9ubHkgYXV0aFRyYW5zZm9ybWVyQ29uZmlnOiBNb2RlbEF1dGhUcmFuc2Zvcm1lckNvbmZpZztcblxuICBvdXRwdXRzOiBTY2hlbWFUcmFuc2Zvcm1lck91dHB1dHM7XG4gIHJlc29sdmVyczogYW55O1xuICBhdXRoUm9sZVBvbGljeTogUmVzb3VyY2UgfCB1bmRlZmluZWQ7XG4gIHVuYXV0aFJvbGVQb2xpY3k6IFJlc291cmNlIHwgdW5kZWZpbmVkO1xuXG4gIGNvbnN0cnVjdG9yKHByb3BzOiBTY2hlbWFUcmFuc2Zvcm1lclByb3BzKSB7XG4gICAgdGhpcy5zY2hlbWFQYXRoID0gcHJvcHMuc2NoZW1hUGF0aCA/PyAnLi9zY2hlbWEuZ3JhcGhxbCc7XG4gICAgdGhpcy5vdXRwdXRQYXRoID0gcHJvcHMub3V0cHV0UGF0aCA/PyAnLi9hcHBzeW5jJztcbiAgICB0aGlzLmlzU3luY0VuYWJsZWQgPSBwcm9wcy5zeW5jRW5hYmxlZCA/PyBmYWxzZTtcbiAgICB0aGlzLmN1c3RvbVZ0bFRyYW5zZm9ybWVyUm9vdERpcmVjdG9yeSA9IHByb3BzLmN1c3RvbVZ0bFRyYW5zZm9ybWVyUm9vdERpcmVjdG9yeSA/PyBwcm9jZXNzLmN3ZCgpO1xuXG4gICAgdGhpcy5vdXRwdXRzID0ge307XG4gICAgdGhpcy5yZXNvbHZlcnMgPSB7fTtcblxuICAgIC8vIFRPRE86IE1ha2UgdGhpcyBiZXR0ZXI/XG4gICAgdGhpcy5hdXRoVHJhbnNmb3JtZXJDb25maWcgPSB7XG4gICAgICBhdXRoQ29uZmlnOiB7XG4gICAgICAgIGRlZmF1bHRBdXRoZW50aWNhdGlvbjoge1xuICAgICAgICAgIGF1dGhlbnRpY2F0aW9uVHlwZTogJ0FNQVpPTl9DT0dOSVRPX1VTRVJfUE9PTFMnLFxuICAgICAgICAgIHVzZXJQb29sQ29uZmlnOiB7XG4gICAgICAgICAgICB1c2VyUG9vbElkOiAnMTIzNDV4eXonLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIGFkZGl0aW9uYWxBdXRoZW50aWNhdGlvblByb3ZpZGVyczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGF1dGhlbnRpY2F0aW9uVHlwZTogJ0FQSV9LRVknLFxuICAgICAgICAgICAgYXBpS2V5Q29uZmlnOiB7XG4gICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiAnVGVzdGluZycsXG4gICAgICAgICAgICAgIGFwaUtleUV4cGlyYXRpb25EYXlzOiAxMDAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgYXV0aGVudGljYXRpb25UeXBlOiAnQVdTX0lBTScsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBhdXRoZW50aWNhdGlvblR5cGU6ICdPUEVOSURfQ09OTkVDVCcsXG4gICAgICAgICAgICBvcGVuSURDb25uZWN0Q29uZmlnOiB7XG4gICAgICAgICAgICAgIG5hbWU6ICdPSURDJyxcbiAgICAgICAgICAgICAgaXNzdWVyVXJsOiAnaHR0cHM6Ly9jb2duaXRvLWlkcC51cy1lYXN0LTEuYW1hem9uYXdzLmNvbS91cy1lYXN0LTFfWFhYJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIHB1YmxpYyB0cmFuc2Zvcm0ocHJlQ2RrVHJhbnNmb3JtZXJzOiBJVHJhbnNmb3JtZXJbXSA9IFtdLCBwb3N0Q2RrVHJhbnNmb3JtZXJzOiBJVHJhbnNmb3JtZXJbXSA9IFtdKSB7XG4gICAgY29uc3QgdHJhbnNmb3JtQ29uZmlnID0gdGhpcy5pc1N5bmNFbmFibGVkID8gdGhpcy5sb2FkQ29uZmlnU3luYygpIDoge307XG5cbiAgICBjb25zdCBwcm92aWRlciA9IG5ldyBUcmFuc2Zvcm1lckZlYXR1cmVGbGFnUHJvdmlkZXIoKTtcblxuICAgIC8vIE5vdGU6IFRoaXMgaXMgbm90IGV4YWN0IGFzIHdlIGFyZSBvbWl0dGluZyB0aGUgQHNlYXJjaGFibGUgdHJhbnNmb3JtZXIgYXMgd2VsbCBhcyBzb21lIG90aGVycy5cbiAgICBjb25zdCB0cmFuc2Zvcm1lciA9IG5ldyBHcmFwaFFMVHJhbnNmb3JtKHtcbiAgICAgIHRyYW5zZm9ybUNvbmZpZzogdHJhbnNmb3JtQ29uZmlnLFxuICAgICAgZmVhdHVyZUZsYWdzOiBwcm92aWRlcixcbiAgICAgIHRyYW5zZm9ybWVyczogW1xuICAgICAgICBuZXcgRHluYW1vREJNb2RlbFRyYW5zZm9ybWVyKCksXG4gICAgICAgIG5ldyBUdGxUcmFuc2Zvcm1lcigpLFxuICAgICAgICBuZXcgVmVyc2lvbmVkTW9kZWxUcmFuc2Zvcm1lcigpLFxuICAgICAgICBuZXcgRnVuY3Rpb25UcmFuc2Zvcm1lcigpLFxuICAgICAgICBuZXcgS2V5VHJhbnNmb3JtZXIoKSxcbiAgICAgICAgbmV3IE1vZGVsQ29ubmVjdGlvblRyYW5zZm9ybWVyKCksXG4gICAgICAgIG5ldyBNb2RlbEF1dGhUcmFuc2Zvcm1lcih0aGlzLmF1dGhUcmFuc2Zvcm1lckNvbmZpZyksXG4gICAgICAgIG5ldyBIdHRwVHJhbnNmb3JtZXIoKSxcbiAgICAgICAgbmV3IEN1c3RvbVZUTFRyYW5zZm9ybWVyKHRoaXMuY3VzdG9tVnRsVHJhbnNmb3JtZXJSb290RGlyZWN0b3J5KSxcbiAgICAgICAgLi4ucHJlQ2RrVHJhbnNmb3JtZXJzLFxuICAgICAgICBuZXcgQ2RrVHJhbnNmb3JtZXIoKSxcbiAgICAgICAgLi4ucG9zdENka1RyYW5zZm9ybWVycyxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBzY2hlbWEgPSBmcy5yZWFkRmlsZVN5bmModGhpcy5zY2hlbWFQYXRoKTtcbiAgICBjb25zdCBjZmRvYyA9IHRyYW5zZm9ybWVyLnRyYW5zZm9ybShzY2hlbWEudG9TdHJpbmcoKSk7XG5cbiAgICAvLyBUT0RPOiBHZXQgVW5hdXRoIFJvbGUgYW5kIEF1dGggUm9sZSBwb2xpY2llcyBmb3IgYXV0aG9yaXphdGlvbiBzdHVmZlxuICAgIHRoaXMudW5hdXRoUm9sZVBvbGljeSA9IGNmZG9jLnJvb3RTdGFjay5SZXNvdXJjZXM/LlVuYXV0aFJvbGVQb2xpY3kwMSBhcyBSZXNvdXJjZSB8fCB1bmRlZmluZWQ7XG4gICAgdGhpcy5hdXRoUm9sZVBvbGljeSA9IGNmZG9jLnJvb3RTdGFjay5SZXNvdXJjZXM/LkF1dGhSb2xlUG9saWN5MDEgYXMgUmVzb3VyY2UgfHwgdW5kZWZpbmVkO1xuXG4gICAgdGhpcy53cml0ZVNjaGVtYShjZmRvYy5zY2hlbWEpO1xuICAgIHRoaXMud3JpdGVSZXNvbHZlcnNUb0ZpbGUoY2Zkb2MucmVzb2x2ZXJzKTtcblxuICAgIC8vIE91dHB1dHMgc2hvdWxkbid0IGJlIG51bGwgYnV0IGRlZmF1bHQgdG8gZW1wdHkgbWFwXG4gICAgdGhpcy5vdXRwdXRzID0gY2Zkb2Mucm9vdFN0YWNrLk91dHB1dHMgPz8ge307XG5cbiAgICByZXR1cm4gdGhpcy5vdXRwdXRzO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldHMgdGhlIHJlc29sdmVycyBmcm9tIHRoZSBgLi9hcHBzeW5jL3Jlc29sdmVyc2AgZm9sZGVyXG4gICAqIEByZXR1cm5zIGFsbCByZXNvbHZlcnNcbiAgICovXG4gIHB1YmxpYyBnZXRSZXNvbHZlcnMoKSB7XG4gICAgY29uc3Qgc3RhdGVtZW50cyA9IFsnUXVlcnknLCAnTXV0YXRpb24nXTtcbiAgICBjb25zdCByZXNvbHZlcnNEaXJQYXRoID0gcGF0aC5ub3JtYWxpemUocGF0aC5qb2luKHRoaXMub3V0cHV0UGF0aCwgJ3Jlc29sdmVycycpKTtcbiAgICBpZiAoZnMuZXhpc3RzU3luYyhyZXNvbHZlcnNEaXJQYXRoKSkge1xuICAgICAgY29uc3QgZmlsZXMgPSBmcy5yZWFkZGlyU3luYyhyZXNvbHZlcnNEaXJQYXRoKTtcbiAgICAgIGZpbGVzLmZvckVhY2goZmlsZSA9PiB7XG4gICAgICAgIC8vIEV4YW1wbGU6IE11dGF0aW9uLmNyZWF0ZUNoYW5uZWwucmVzcG9uc2VcbiAgICAgICAgbGV0IGFyZ3MgPSBmaWxlLnNwbGl0KCcuJyk7XG4gICAgICAgIGxldCB0eXBlTmFtZTogc3RyaW5nID0gYXJnc1swXTtcbiAgICAgICAgbGV0IGZpZWxkTmFtZTogc3RyaW5nID0gYXJnc1sxXTtcbiAgICAgICAgbGV0IHRlbXBsYXRlVHlwZSA9IGFyZ3NbMl07IC8vIHJlcXVlc3Qgb3IgcmVzcG9uc2VcblxuICAgICAgICAvLyBkZWZhdWx0IHRvIGNvbXBvc2l0ZSBrZXkgb2YgdHlwZU5hbWUgYW5kIGZpZWxkTmFtZSwgaG93ZXZlciBpZiBpdFxuICAgICAgICAvLyBpcyBRdWVyeSwgTXV0YXRpb24gb3IgU3Vic2NyaXB0aW9uICh0b3AgbGV2ZWwpIHRoZSBjb21wb3NpdGVLZXkgaXMgdGhlXG4gICAgICAgIC8vIHNhbWUgYXMgZmllbGROYW1lIG9ubHlcbiAgICAgICAgbGV0IGNvbXBvc2l0ZUtleSA9IGAke3R5cGVOYW1lfSR7ZmllbGROYW1lfWA7XG4gICAgICAgIGlmIChzdGF0ZW1lbnRzLmluZGV4T2YodHlwZU5hbWUpID49IDApIHtcbiAgICAgICAgICBpZiAoIXRoaXMub3V0cHV0cy5ub25lUmVzb2x2ZXJzIHx8ICF0aGlzLm91dHB1dHMubm9uZVJlc29sdmVyc1tjb21wb3NpdGVLZXldKSBjb21wb3NpdGVLZXkgPSBmaWVsZE5hbWU7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgZmlsZXBhdGggPSBwYXRoLm5vcm1hbGl6ZShwYXRoLmpvaW4ocmVzb2x2ZXJzRGlyUGF0aCwgZmlsZSkpO1xuXG4gICAgICAgIGlmIChzdGF0ZW1lbnRzLmluZGV4T2YodHlwZU5hbWUpID49IDAgfHwgKHRoaXMub3V0cHV0cy5ub25lUmVzb2x2ZXJzICYmIHRoaXMub3V0cHV0cy5ub25lUmVzb2x2ZXJzW2NvbXBvc2l0ZUtleV0pKSB7XG4gICAgICAgICAgaWYgKCF0aGlzLnJlc29sdmVyc1tjb21wb3NpdGVLZXldKSB7XG4gICAgICAgICAgICB0aGlzLnJlc29sdmVyc1tjb21wb3NpdGVLZXldID0ge1xuICAgICAgICAgICAgICB0eXBlTmFtZTogdHlwZU5hbWUsXG4gICAgICAgICAgICAgIGZpZWxkTmFtZTogZmllbGROYW1lLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAodGVtcGxhdGVUeXBlID09PSAncmVxJykge1xuICAgICAgICAgICAgdGhpcy5yZXNvbHZlcnNbY29tcG9zaXRlS2V5XS5yZXF1ZXN0TWFwcGluZ1RlbXBsYXRlID0gZmlsZXBhdGg7XG4gICAgICAgICAgfSBlbHNlIGlmICh0ZW1wbGF0ZVR5cGUgPT09ICdyZXMnKSB7XG4gICAgICAgICAgICB0aGlzLnJlc29sdmVyc1tjb21wb3NpdGVLZXldLnJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlID0gZmlsZXBhdGg7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuaXNIdHRwUmVzb2x2ZXIodHlwZU5hbWUsIGZpZWxkTmFtZSkpIHtcbiAgICAgICAgICBpZiAoIXRoaXMucmVzb2x2ZXJzW2NvbXBvc2l0ZUtleV0pIHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZXJzW2NvbXBvc2l0ZUtleV0gPSB7XG4gICAgICAgICAgICAgIHR5cGVOYW1lOiB0eXBlTmFtZSxcbiAgICAgICAgICAgICAgZmllbGROYW1lOiBmaWVsZE5hbWUsXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh0ZW1wbGF0ZVR5cGUgPT09ICdyZXEnKSB7XG4gICAgICAgICAgICB0aGlzLnJlc29sdmVyc1tjb21wb3NpdGVLZXldLnJlcXVlc3RNYXBwaW5nVGVtcGxhdGUgPSBmaWxlcGF0aDtcbiAgICAgICAgICB9IGVsc2UgaWYgKHRlbXBsYXRlVHlwZSA9PT0gJ3JlcycpIHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZXJzW2NvbXBvc2l0ZUtleV0ucmVzcG9uc2VNYXBwaW5nVGVtcGxhdGUgPSBmaWxlcGF0aDtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7IC8vIFRoaXMgaXMgYSBHU0lcbiAgICAgICAgICBpZiAoIXRoaXMucmVzb2x2ZXJzLmdzaSkge1xuICAgICAgICAgICAgdGhpcy5yZXNvbHZlcnMuZ3NpID0ge307XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICghdGhpcy5yZXNvbHZlcnMuZ3NpW2NvbXBvc2l0ZUtleV0pIHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZXJzLmdzaVtjb21wb3NpdGVLZXldID0ge1xuICAgICAgICAgICAgICB0eXBlTmFtZTogdHlwZU5hbWUsXG4gICAgICAgICAgICAgIGZpZWxkTmFtZTogZmllbGROYW1lLFxuICAgICAgICAgICAgICB0YWJsZU5hbWU6IGZpZWxkTmFtZS5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIGZpZWxkTmFtZS5zbGljZSgxKSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHRlbXBsYXRlVHlwZSA9PT0gJ3JlcScpIHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZXJzLmdzaVtjb21wb3NpdGVLZXldLnJlcXVlc3RNYXBwaW5nVGVtcGxhdGUgPSBmaWxlcGF0aDtcbiAgICAgICAgICB9IGVsc2UgaWYgKHRlbXBsYXRlVHlwZSA9PT0gJ3JlcycpIHtcbiAgICAgICAgICAgIHRoaXMucmVzb2x2ZXJzLmdzaVtjb21wb3NpdGVLZXldLnJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlID0gZmlsZXBhdGg7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5yZXNvbHZlcnM7XG4gIH1cblxuICAvKipcbiAgICogZGVjaWRlcyBpZiB0aGlzIGlzIGEgcmVzb2x2ZXIgZm9yIGFuIEhUVFAgZGF0YXNvdXJjZVxuICAgKiBAcGFyYW0gdHlwZU5hbWVcbiAgICogQHBhcmFtIGZpZWxkTmFtZVxuICAgKi9cblxuICBwcml2YXRlIGlzSHR0cFJlc29sdmVyKHR5cGVOYW1lOiBzdHJpbmcsIGZpZWxkTmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKCF0aGlzLm91dHB1dHMuaHR0cFJlc29sdmVycykgcmV0dXJuIGZhbHNlO1xuXG4gICAgZm9yIChjb25zdCBlbmRwb2ludCBpbiB0aGlzLm91dHB1dHMuaHR0cFJlc29sdmVycykge1xuICAgICAgZm9yIChjb25zdCByZXNvbHZlciBvZiB0aGlzLm91dHB1dHMuaHR0cFJlc29sdmVyc1tlbmRwb2ludF0pIHtcbiAgICAgICAgaWYgKHJlc29sdmVyLnR5cGVOYW1lID09PSB0eXBlTmFtZSAmJiByZXNvbHZlci5maWVsZE5hbWUgPT09IGZpZWxkTmFtZSkgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLyoqXG4gICAgICogV3JpdGVzIHRoZSBzY2hlbWEgdG8gdGhlIG91dHB1dCBkaXJlY3RvcnkgZm9yIHVzZSB3aXRoIEBhd3MtY2RrL2F3cy1hcHBzeW5jXG4gICAgICogQHBhcmFtIHNjaGVtYVxuICAgICAqL1xuICBwcml2YXRlIHdyaXRlU2NoZW1hKHNjaGVtYTogYW55KSB7XG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKHRoaXMub3V0cHV0UGF0aCkpIHtcbiAgICAgIGZzLm1rZGlyU3luYyh0aGlzLm91dHB1dFBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIH1cblxuICAgIGZzLndyaXRlRmlsZVN5bmMoYCR7dGhpcy5vdXRwdXRQYXRofS9zY2hlbWEuZ3JhcGhxbGAsIHNjaGVtYSk7XG4gIH1cblxuICAvKipcbiAgICAgKiBXcml0ZXMgYWxsIHRoZSByZXNvbHZlcnMgdG8gdGhlIG91dHB1dCBkaXJlY3RvcnkgZm9yIGxvYWRpbmcgaW50byB0aGUgZGF0YXNvdXJjZXMgbGF0ZXJcbiAgICAgKiBAcGFyYW0gcmVzb2x2ZXJzXG4gICAgICovXG4gIHByaXZhdGUgd3JpdGVSZXNvbHZlcnNUb0ZpbGUocmVzb2x2ZXJzOiBhbnkpIHtcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmModGhpcy5vdXRwdXRQYXRoKSkge1xuICAgICAgZnMubWtkaXJTeW5jKHRoaXMub3V0cHV0UGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgcmVzb2x2ZXJGb2xkZXJQYXRoID0gcGF0aC5ub3JtYWxpemUocGF0aC5qb2luKHRoaXMub3V0cHV0UGF0aCwgJ3Jlc29sdmVycycpKTtcbiAgICBpZiAoZnMuZXhpc3RzU3luYyhyZXNvbHZlckZvbGRlclBhdGgpKSB7XG4gICAgICBjb25zdCBmaWxlcyA9IGZzLnJlYWRkaXJTeW5jKHJlc29sdmVyRm9sZGVyUGF0aCk7XG4gICAgICBmaWxlcy5mb3JFYWNoKGZpbGUgPT4gZnMudW5saW5rU3luYyhyZXNvbHZlckZvbGRlclBhdGggKyAnLycgKyBmaWxlKSk7XG4gICAgICBmcy5ybWRpclN5bmMocmVzb2x2ZXJGb2xkZXJQYXRoKTtcbiAgICB9XG5cbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMocmVzb2x2ZXJGb2xkZXJQYXRoKSkge1xuICAgICAgZnMubWtkaXJTeW5jKHJlc29sdmVyRm9sZGVyUGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSk7XG4gICAgfVxuXG4gICAgT2JqZWN0LmtleXMocmVzb2x2ZXJzKS5mb3JFYWNoKChrZXk6IGFueSkgPT4ge1xuICAgICAgY29uc3QgcmVzb2x2ZXIgPSByZXNvbHZlcnNba2V5XTtcbiAgICAgIGNvbnN0IGZpbGVOYW1lID0ga2V5LnJlcGxhY2UoJy52dGwnLCAnJyk7XG4gICAgICBjb25zdCByZXNvbHZlckZpbGVQYXRoID0gcGF0aC5ub3JtYWxpemUocGF0aC5qb2luKHJlc29sdmVyRm9sZGVyUGF0aCwgZmlsZU5hbWUpKTtcbiAgICAgIGZzLndyaXRlRmlsZVN5bmMocmVzb2x2ZXJGaWxlUGF0aCwgcmVzb2x2ZXIpO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAgICogQHJldHVybnMge0BsaW5rIFRyYW5zZm9ybUNvbmZpZ31cbiAgICAqL1xuICBwcml2YXRlIGxvYWRDb25maWdTeW5jKHByb2plY3REaXI6IHN0cmluZyA9ICdyZXNvdXJjZXMnKTogVHJhbnNmb3JtQ29uZmlnIHtcbiAgICAvLyBJbml0aWFsaXplIHRoZSBjb25maWcgYWx3YXlzIHdpdGggdGhlIGxhdGVzdCB2ZXJzaW9uLCBvdGhlciBtZW1iZXJzIGFyZSBvcHRpb25hbCBmb3Igbm93LlxuICAgIGxldCBjb25maWc6IFRyYW5zZm9ybUNvbmZpZyA9IHtcbiAgICAgIFZlcnNpb246IFRSQU5TRk9STV9DVVJSRU5UX1ZFUlNJT04sXG4gICAgICBSZXNvbHZlckNvbmZpZzoge1xuICAgICAgICBwcm9qZWN0OiB7XG4gICAgICAgICAgQ29uZmxpY3RIYW5kbGVyOiBDb25mbGljdEhhbmRsZXJUeXBlLk9QVElNSVNUSUMsXG4gICAgICAgICAgQ29uZmxpY3REZXRlY3Rpb246ICdWRVJTSU9OJyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIGNvbnN0IGNvbmZpZ0RpciA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsIHByb2plY3REaXIpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbmZpZ1BhdGggPSBwYXRoLmpvaW4oY29uZmlnRGlyLCBUUkFOU0ZPUk1fQ09ORklHX0ZJTEVfTkFNRSk7XG4gICAgICBjb25zdCBjb25maWdFeGlzdHMgPSBmcy5leGlzdHNTeW5jKGNvbmZpZ1BhdGgpO1xuICAgICAgaWYgKGNvbmZpZ0V4aXN0cykge1xuICAgICAgICBjb25zdCBjb25maWdTdHIgPSBmcy5yZWFkRmlsZVN5bmMoY29uZmlnUGF0aCk7XG4gICAgICAgIGNvbmZpZyA9IEpTT04ucGFyc2UoY29uZmlnU3RyLnRvU3RyaW5nKCkpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gY29uZmlnIGFzIFRyYW5zZm9ybUNvbmZpZztcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHJldHVybiBjb25maWc7XG4gICAgfVxuICB9XG59XG5cblxuLyoqXG4gKiBHcmFiYmVkIGZyb20gQW1wbGlmeVxuICogaHR0cHM6Ly9naXRodWIuY29tL2F3cy1hbXBsaWZ5L2FtcGxpZnktY2xpL2Jsb2IvZWI5MjU3ZWFlZTExN2QwZWQ1M2ViYzIzYWEyOGVjZDdiNzUxMGZhMS9wYWNrYWdlcy9ncmFwaHFsLXRyYW5zZm9ybWVyLWNvcmUvc3JjL0ZlYXR1cmVGbGFncy50c1xuICovXG5leHBvcnQgY2xhc3MgVHJhbnNmb3JtZXJGZWF0dXJlRmxhZ1Byb3ZpZGVyIGltcGxlbWVudHMgRmVhdHVyZUZsYWdQcm92aWRlciB7XG4gIGdldEJvb2xlYW4oZmVhdHVyZU5hbWU6IHN0cmluZywgb3B0aW9ucz86IGJvb2xlYW4pOiBib29sZWFuIHtcbiAgICBzd2l0Y2ggKGZlYXR1cmVOYW1lKSB7XG4gICAgICBjYXNlICdpbXByb3ZlUGx1cmFsaXphdGlvbic6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgY2FzZSAndmFsaWRhdGVUeXBlTmFtZVJlc2VydmVkV29yZHMnOlxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4gdGhpcy5nZXRWYWx1ZTxib29sZWFuPihmZWF0dXJlTmFtZSwgb3B0aW9ucyk7XG4gICAgfVxuICB9XG4gIGdldFN0cmluZyhmZWF0dXJlTmFtZTogc3RyaW5nLCBvcHRpb25zPzogc3RyaW5nKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5nZXRWYWx1ZTxzdHJpbmc+KGZlYXR1cmVOYW1lLCBvcHRpb25zKTtcbiAgfVxuICBnZXROdW1iZXIoZmVhdHVyZU5hbWU6IHN0cmluZywgb3B0aW9ucz86IG51bWJlcik6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0VmFsdWU8bnVtYmVyPihmZWF0dXJlTmFtZSwgb3B0aW9ucyk7XG4gIH1cbiAgZ2V0T2JqZWN0KCk6IG9iamVjdCB7XG4gICAgLy8gVG9kbzogZm9yIGZ1dHVyZSBleHRlbnNpYmlsaXR5XG4gICAgdGhyb3cgbmV3IEVycm9yKCdOb3QgaW1wbGVtZW50ZWQnKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRWYWx1ZTxUIGV4dGVuZHMgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbj4oZmVhdHVyZU5hbWU6IHN0cmluZywgZGVmYXVsdFZhbHVlPzogVCk6IFQge1xuICAgIGlmIChkZWZhdWx0VmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIGRlZmF1bHRWYWx1ZTtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKGBObyB2YWx1ZSBmb3VuZCBmb3IgZmVhdHVyZSAke2ZlYXR1cmVOYW1lfWApO1xuICB9XG59Il19