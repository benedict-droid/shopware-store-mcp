import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StoreApiClient, StoreCredentialsSchema } from "../client.js";

export function registerCategoryTools(server: McpServer) {
    server.registerTool(
        "store_category_list",
        {
            description: "List available product categories.",
            inputSchema: StoreCredentialsSchema.merge(z.object({
                limit: z.number().default(10).describe("Max number of categories to return"),
            })).shape
        },
        async (args) => {
            console.log("Executing store_category_list with args:", args);
            const client = new StoreApiClient({
                swAccessKey: args.swAccessKey,
                swContextToken: args.swContextToken,
                swLanguageId: "2fbb5fe2e29a4d70aa5854ce7ce3e20b", // Hardcoded English Language ID
                shopUrl: args.shopUrl
            });

            try {
                const response = await client.post<any>("category", {
                    limit: args.limit,
                    includes: {
                        category: ["id", "name", "parentId", "active", "level"]
                    }
                });

                if (!response.elements || response.elements.length === 0) {
                    return {
                        content: [{ type: "text", text: "No categories found." }]
                    };
                }

                const categories = response.elements.map((c: any) => {
                    const name = c.name || "Unknown";
                    return `- ${name} (ID: ${c.id})`;
                }).join("\n");

                return {
                    content: [{ type: "text", text: `Available Categories:\n${categories}` }]
                };
            } catch (error) {
                console.error("Failed to fetch categories:", error);
                return {
                    isError: true,
                    content: [{ type: "text", text: `Failed to fetch categories.` }]
                };
            }
        }
    );

    server.registerTool(
        "store_product_listing",
        {
            description: "Get products for a specific category.",
            inputSchema: StoreCredentialsSchema.merge(z.object({
                categoryId: z.string().describe("The UUID of the category"),
                limit: z.number().default(5).describe("Max number of products to return"),
            })).shape
        },
        async (args) => {
            console.log("Executing store_category_products with args:", args);
            const client = new StoreApiClient({
                swAccessKey: args.swAccessKey,
                swContextToken: args.swContextToken,
                swLanguageId: "2fbb5fe2e29a4d70aa5854ce7ce3e20b", // Hardcoded English Language ID
                shopUrl: args.shopUrl
            });

            try {
                // Use POST /product-listing/{categoryId}
                const response = await client.post<any>(`product-listing/${args.categoryId}`, {
                    limit: args.limit,
                    includes: {
                        product: ["id", "productNumber", "name", "translated", "stock", "calculatedPrice", "parentId", "options", "properties", "availableStock"],
                        product_media: ["media"],
                        media: ["url"]
                    },
                    associations: {
                        properties: {
                            associations: {
                                group: {}
                            }
                        },
                        options: {
                            associations: {
                                group: {}
                            }
                        }
                    }
                });

                if (!response.elements || response.elements.length === 0) {
                    return {
                        content: [{ type: "text", text: `No products found in category ${args.categoryId}.` }]
                    };
                }

                // Collect parent IDs for variants that are missing names
                const parentIds = [...new Set(response.elements
                    .filter((p: any) => !p.name && !p.translated?.name && p.parentId)
                    .map((p: any) => p.parentId))];

                let parents = new Map();
                if (parentIds.length > 0) {
                    try {
                        const parentResponse = await client.post<any>("product", {
                            ids: parentIds,
                            limit: parentIds.length
                        });
                        if (parentResponse.elements) {
                            parentResponse.elements.forEach((p: any) => {
                                parents.set(p.id, p);
                            });
                        }
                    } catch (e) {
                        // Ignore error for parents
                    }
                }

                const products = response.elements.map((p: any) => {
                    let name = p.name ?? p.translated?.name;

                    if (!name && p.parentId) {
                        const parent = parents.get(p.parentId);
                        if (parent) {
                            name = parent.name ?? parent.translated?.name;
                        }
                    }
                    name = name ?? "Unknown";

                    const opts = p.properties && p.properties.length > 0 ? p.properties : p.options;
                    const optionsStr = opts?.map((o: any) => {
                        const group = o.group?.name ?? o.group?.translated?.name;
                        const option = o.name ?? o.translated?.name;
                        return group ? `${group}: ${option}` : option;
                    }).join(" | ");

                    const fullName = optionsStr ? `${name} ( ${optionsStr} )` : name;
                    const price = p.calculatedPrice?.totalPrice ? p.calculatedPrice.totalPrice : "N/A";

                    return `- [${fullName}] (ID: ${p.id}, SKU: ${p.productNumber}) - Price: ${price} - Stock: ${p.availableStock ?? "Unknown"}`;
                }).join("\n");

                return {
                    content: [{ type: "text", text: `Products in category:\n${products}` }]
                };
            } catch (error) {
                console.error("Failed to fetch product listing:", error);
                return {
                    isError: true,
                    content: [{ type: "text", text: `Failed to fetch products for category ${args.categoryId}.` }]
                };
            }
        }
    );
}
