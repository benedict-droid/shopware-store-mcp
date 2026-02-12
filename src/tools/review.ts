import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StoreApiClient, StoreCredentialsSchema } from "../client.js";

export function registerReviewTools(server: McpServer) {
    server.registerTool(
        "store_product_reviews",
        {
            description: "Get customer reviews for a specific product.",
            inputSchema: StoreCredentialsSchema.merge(z.object({
                productId: z.string().describe("The UUID of the product"),
                limit: z.number().default(5).describe("Max number of reviews to return"),
            })).shape
        },
        async (args) => {
            const client = new StoreApiClient({
                swAccessKey: args.swAccessKey,
                swContextToken: args.swContextToken,
                swLanguageId: args.swLanguageId || "2fbb5fe2e29a4d70aa5854ce7ce3e20b",
                shopUrl: args.shopUrl
            });

            // Resolve Product ID (handles SKU or UUID)
            const resolvedId = await client.resolveProductId(args.productId);
            if (!resolvedId) {
                return {
                    content: [{ type: "text", text: `Product not found: ${args.productId}` }]
                };
            }

            try {
                // POST /store-api/product/{productId}/reviews
                let response = await client.post<any>(`product/${resolvedId}/reviews`, {
                    limit: args.limit,
                    includes: {
                        product_review: ["id", "title", "content", "points", "createdAt", "externalUser"]
                    }
                });

                if (!response.elements || response.elements.length === 0) {

                    // FALLBACK: Try fetching from PARENT if this product is a variant
                    // 1. Get Parent ID
                    try {
                        const productRes = await client.post<any>("product", {
                            ids: [resolvedId],
                            includes: { product: ["parentId"] }
                        });
                        const parentId = productRes.elements?.[0]?.parentId;

                        if (parentId) {
                            // 2. Fetch Parent Reviews
                            response = await client.post<any>(`product/${parentId}/reviews`, {
                                limit: args.limit,
                                includes: {
                                    product_review: ["id", "title", "content", "points", "createdAt", "externalUser"]
                                }
                            });
                        }
                    } catch (e) { /* Ignore errors, just return empty */ }

                    // Double check after fallback
                    if (!response.elements || response.elements.length === 0) {
                        return {
                            content: [{ type: "text", text: `No reviews found for product ${args.productId}.` }]
                        };
                    }
                }

                const reviews = response.elements.map((r: any) => {
                    const date = new Date(r.createdAt).toLocaleDateString();
                    const title = r.title || "No Title";
                    const content = r.content || "";
                    const points = r.points || 0;
                    return `- [${points}/5] ${title} (${date}): "${content}"`;
                }).join("\n\n");

                return {
                    content: [{ type: "text", text: `Product Reviews:\n${reviews}` }]
                };

            } catch (error) {
                console.error("Failed to fetch reviews:", error);
                return {
                    isError: true,
                    content: [{ type: "text", text: `Failed to fetch reviews for product ${args.productId}.` }]
                };
            }
        }
    );
}
