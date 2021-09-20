import { ITransformer } from 'graphql-transformer-core';
import { CdkTransformerTable, CdkTransformerResolver, CdkTransformerFunctionResolver, CdkTransformerHttpResolver } from './cdk-transformer';
import { Resource } from './resource';
export interface SchemaTransformerProps {
    /**
     * File path to the graphql schema
     * @default schema.graphql
     */
    readonly schemaPath?: string;
    /**
     * Path where transformed schema and resolvers will be placed
     * @default appsync
     */
    readonly outputPath?: string;
    /**
     * Set deletion protection on DynamoDB tables
     * @default true
     */
    readonly deletionProtectionEnabled?: boolean;
    /**
     * Whether to enable DataStore or not
     * @default false
     */
    readonly syncEnabled?: boolean;
}
/**
 * @experimental
 */
export interface SchemaTransformerOutputs {
    /**
     * @experimental
     */
    readonly cdkTables?: {
        [name: string]: CdkTransformerTable;
    };
    /**
     * @experimental
     */
    readonly noneResolvers?: {
        [name: string]: CdkTransformerResolver;
    };
    /**
     * @experimental
     */
    readonly functionResolvers?: {
        [name: string]: CdkTransformerFunctionResolver[];
    };
    /**
     * @experimental
     */
    readonly httpResolvers?: {
        [name: string]: CdkTransformerHttpResolver[];
    };
    /**
     * @experimental
     */
    readonly queries?: {
        [name: string]: string;
    };
    /**
     * @experimental
     */
    readonly mutations?: {
        [name: string]: CdkTransformerResolver;
    };
    /**
     * @experimental
     */
    readonly subscriptions?: {
        [name: string]: CdkTransformerResolver;
    };
}
export declare class SchemaTransformer {
    readonly schemaPath: string;
    readonly outputPath: string;
    readonly isSyncEnabled: boolean;
    private readonly authTransformerConfig;
    outputs: SchemaTransformerOutputs;
    resolvers: any;
    authRolePolicy: Resource | undefined;
    unauthRolePolicy: Resource | undefined;
    constructor(props: SchemaTransformerProps);
    transform(preCdkTransformers?: ITransformer[], postCdkTransformers?: ITransformer[]): SchemaTransformerOutputs;
    /**
     * Gets the resolvers from the `./appsync/resolvers` folder
     * @returns all resolvers
     */
    getResolvers(): any;
    /**
     * decides if this is a resolver for an HTTP datasource
     * @param typeName
     * @param fieldName
     */
    private isHttpResolver;
    /**
       * Writes the schema to the output directory for use with @aws-cdk/aws-appsync
       * @param schema
       */
    private writeSchema;
    /**
       * Writes all the resolvers to the output directory for loading into the datasources later
       * @param resolvers
       */
    private writeResolversToFile;
    /**
       * @returns {@link TransformConfig}
      */
    private loadConfigSync;
}
