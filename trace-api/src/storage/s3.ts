/**
 * S3-compatible storage configuration.
 */
export interface StorageConfig {
	/** S3 bucket name */
	bucket: string;
	/** S3-compatible endpoint URL */
	endpoint: string;
	/** Access key ID for authentication */
	accessKeyId: string;
	/** Secret access key for authentication */
	secretAccessKey: string;
	/** AWS region (default: 'auto', works for R2) */
	region?: string;
}

/**
 * Storage interface for trace data operations.
 */
export interface TraceStorage {
	/**
	 * Write data to storage.
	 * @param path - Storage path (e.g., "traces/{traceId}/test.json")
	 * @param data - Data to write (string or ArrayBuffer)
	 * @param contentType - MIME type of the content
	 */
	put(
		path: string,
		data: string | ArrayBuffer,
		contentType: string,
	): Promise<void>;

	/**
	 * Read data from storage.
	 * @param path - Storage path
	 * @returns Data as ArrayBuffer, or null if not found
	 */
	get(path: string): Promise<ArrayBuffer | null>;

	/**
	 * List objects under a prefix.
	 * @param prefix - Path prefix to list
	 * @returns Array of object keys
	 */
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
