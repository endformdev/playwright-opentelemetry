export interface StorageConfig {
	/** S3 bucket name */
	bucket: string;
	/** S3-compatible endpoint URL */
	endpoint: string;
	accessKeyId: string;
	secretAccessKey: string;
	/** AWS region (default: 'auto', works for R2) */
	region?: string;
}

export interface TraceStorage {
	put(
		path: string,
		data: string | ArrayBuffer,
		contentType: string,
	): Promise<void>;

	get(path: string): Promise<ArrayBuffer | null>;

	list(prefix: string): Promise<string[]>;
}

/**
 * Create an S3-compatible storage implementation using aws4fetch.
 *
 * @param config - S3 storage configuration
 * @returns TraceStorage implementation
 *
 * @example
 * ```ts
 * const storage = createS3Storage({
 *   bucket: 'my-traces',
 *   endpoint: 'https://xxx.r2.cloudflarestorage.com',
 *   accessKeyId: env.R2_ACCESS_KEY_ID,
 *   secretAccessKey: env.R2_SECRET_ACCESS_KEY,
 *   region: 'auto',
 * });
 * ```
 */
export function createS3Storage(_config: StorageConfig): TraceStorage {
	// TODO: Implement using aws4fetch
	return {
		async put(_path, _data, _contentType) {
			throw new Error("createS3Storage: put() not implemented");
		},
		async get(_path) {
			throw new Error("createS3Storage: get() not implemented");
		},
		async list(_prefix) {
			throw new Error("createS3Storage: list() not implemented");
		},
	};
}
