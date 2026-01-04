import { AwsClient } from "aws4fetch";

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
export function createS3Storage(config: StorageConfig): TraceStorage {
	const {
		bucket,
		endpoint,
		accessKeyId,
		secretAccessKey,
		region = "auto",
	} = config;

	// Remove trailing slash from endpoint if present
	const baseUrl = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;

	// Create AWS client for signing requests
	const aws = new AwsClient({
		accessKeyId,
		secretAccessKey,
		region,
		service: "s3",
	});

	return {
		async put(path: string, data: string | ArrayBuffer, contentType: string) {
			// Convert string to ArrayBuffer if needed
			const body =
				typeof data === "string" ? new TextEncoder().encode(data) : data;

			// Construct the S3 URL
			const url = `${baseUrl}/${bucket}/${path}`;

			// Make signed PUT request
			const response = await aws.fetch(url, {
				method: "PUT",
				headers: {
					"Content-Type": contentType,
				},
				body,
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`S3 PUT failed for ${path}: ${response.status} ${response.statusText} - ${errorText}`,
				);
			}
		},

		async get(path: string): Promise<ArrayBuffer | null> {
			// Construct the S3 URL
			const url = `${baseUrl}/${bucket}/${path}`;

			// Make signed GET request
			const response = await aws.fetch(url, {
				method: "GET",
			});

			if (response.status === 404) {
				return null;
			}

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`S3 GET failed for ${path}: ${response.status} ${response.statusText} - ${errorText}`,
				);
			}

			return response.arrayBuffer();
		},

		async list(prefix: string): Promise<string[]> {
			// Construct ListObjectsV2 URL with query parameters
			const url = new URL(`${baseUrl}/${bucket}`);
			url.searchParams.set("list-type", "2");
			url.searchParams.set("prefix", prefix);

			// Make signed GET request for listing
			const response = await aws.fetch(url.toString(), {
				method: "GET",
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`S3 LIST failed for prefix ${prefix}: ${response.status} ${response.statusText} - ${errorText}`,
				);
			}

			// Parse XML response
			const xmlText = await response.text();

			// Extract keys from XML using regex (simple approach for ListObjectsV2 response)
			// Format: <Key>path/to/file.json</Key>
			const keyRegex = /<Key>([^<]+)<\/Key>/g;
			const keys: string[] = [];

			for (const match of xmlText.matchAll(keyRegex)) {
				keys.push(match[1]);
			}

			return keys.sort();
		},
	};
}
