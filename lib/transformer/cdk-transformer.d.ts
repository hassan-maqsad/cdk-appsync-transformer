import { Transformer, TransformerContext } from 'graphql-transformer-core';
/**
 * @experimental
 */
export interface CdkTransformerTableKey {
    /**
     * @experimental
     */
    readonly name: string;
    /**
     * @experimental
     */
    readonly type: string;
}
/**
 * @experimental
 */
export interface CdkTransformerLocalSecondaryIndex {
    /**
     * @experimental
     */
    readonly indexName: string;
    /**
     * @experimental
     */
    readonly projection: any;
    /**
     * @experimental
     */
    readonly sortKey: CdkTransformerTableKey;
}
/**
 * @experimental
 */
export interface CdkTransformerGlobalSecondaryIndex {
    /**
     * @experimental
     */
    readonly indexName: string;
    /**
     * @experimental
     */
    readonly projection: any;
    /**
     * @experimental
     */
    readonly partitionKey: CdkTransformerTableKey;
    /**
     * @experimental
     */
    readonly sortKey: CdkTransformerTableKey;
}
/**
 * @experimental
 */
export interface CdkTransformerTableTtl {
    /**
     * @experimental
     */
    readonly attributeName: string;
    /**
     * @experimental
     */
    readonly enabled: boolean;
}
/**
 * @experimental
 */
export interface CdkTransformerTable {
    /**
     * @experimental
     */
    readonly tableName: string;
    /**
     * @experimental
     */
    readonly partitionKey: CdkTransformerTableKey;
    /**
     * @experimental
     */
    readonly sortKey?: CdkTransformerTableKey;
    /**
     * @experimental
     */
    readonly ttl?: CdkTransformerTableTtl;
    /**
     * @experimental
     */
    readonly localSecondaryIndexes: CdkTransformerLocalSecondaryIndex[];
    /**
     * @experimental
     */
    readonly globalSecondaryIndexes: CdkTransformerGlobalSecondaryIndex[];
    /**
     * @experimental
     */
    readonly resolvers: string[];
    /**
     * @experimental
     */
    readonly gsiResolvers: string[];
}
/**
 * @experimental
 */
export interface CdkTransformerResolver {
    /**
     * @experimental
     */
    readonly typeName: string;
    /**
     * @experimental
     */
    readonly fieldName: string;
}
/**
 * @experimental
 */
export interface CdkTransformerHttpResolver extends CdkTransformerResolver {
    /**
     * @experimental
     */
    readonly httpConfig: any;
    /**
     * @experimental
     */
    readonly defaultRequestMappingTemplate: string;
    /**
     * @experimental
     */
    readonly defaultResponseMappingTemplate: string;
}
/**
 * @experimental
 */
export interface CdkTransformerFunctionResolver extends CdkTransformerResolver {
    /**
     * @experimental
     */
    readonly defaultRequestMappingTemplate: string;
    /**
     * @experimental
     */
    readonly defaultResponseMappingTemplate: string;
}
export declare class CdkTransformer extends Transformer {
    tables: {
        [name: string]: CdkTransformerTable;
    };
    noneDataSources: {
        [name: string]: CdkTransformerResolver;
    };
    functionResolvers: {
        [name: string]: CdkTransformerFunctionResolver[];
    };
    httpResolvers: {
        [name: string]: CdkTransformerHttpResolver[];
    };
    resolverTableMap: {
        [name: string]: string;
    };
    gsiResolverTableMap: {
        [name: string]: string;
    };
    constructor();
    after: (ctx: TransformerContext) => void;
    private buildResources;
    private buildTablesFromResource;
    private parseKeySchema;
}
