import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StoreApiClient, StoreCredentialsSchema } from "../client.js";

export function registerCategoryTools(server: McpServer) {
    server.registerTool(
        "store_category_list",
        {
            description: "List available product categories. Can be used to list root categories or subcategories.",
            inputSchema: StoreCredentialsSchema.merge(z.object({
                limit: z.number().default(20).describe("Max number of categories to return"),
                parentId: z.string().optional().describe("Optional. Provide a category ID to list its subcategories. Leave empty to list top-level categories.")
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
                let targetParentId = args.parentId;

                // If no specific parentId is requested, fetch the store's root navigation category
                if (!targetParentId) {
                    try {
                        const contextRes = await client.get<any>("context");
                        targetParentId = contextRes.salesChannel?.navigationCategoryId;
                    } catch (e) {
                        console.warn("Failed to fetch context for navigation root:", e);
                    }
                }

                const filters: any[] = [
                    { type: "equals", field: "active", value: true }
                ];

                if (targetParentId) {
                    filters.push({ type: "equals", field: "parentId", value: targetParentId });
                }

                const response = await client.post<any>("category", {
                    limit: args.limit,
                    filter: filters,
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
            description: "Get products for a specific category. You must provide either categoryId or categoryName.",
            inputSchema: StoreCredentialsSchema.merge(z.object({
                categoryId: z.string().optional().describe("The UUID of the category (optional if name is provided)"),
                categoryName: z.string().optional().describe("The name of the category (optional if ID is provided)"),
                limit: z.number().max(3).default(3).describe("Max number of products to return"),
                page: z.number().default(1).describe("The page number"),
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
                let targetCategoryId = args.categoryId;

                // Resolve categoryName to categoryId if needed
                if (!targetCategoryId && args.categoryName) {
                    const catRes = await client.post<any>("category", {
                        filter: [{ type: "equals", field: "name", value: args.categoryName }],
                        limit: 1
                    });
                    if (catRes.elements && catRes.elements.length > 0) {
                        targetCategoryId = catRes.elements[0].id;
                    } else {
                        return { content: [{ type: "text", text: `Category '${args.categoryName}' not found.` }] };
                    }
                }

                if (!targetCategoryId) {
                    return { content: [{ type: "text", text: `You must provide either a valid categoryId or categoryName.` }] };
                }

                // Use POST /product-listing/{categoryId}
                const response = await client.post<any>(`product-listing/${targetCategoryId}`, {
                    limit: args.limit,
                    p: args.page,
                    includes: {
                        product: ["id", "productNumber", "name", "translated", "stock", "calculatedPrice", "parentId", "options", "properties", "availableStock", "seoUrls", "media", "cover", "description"],
                        product_media: ["media"],
                        media: ["url"],
                        seo_url: ["seoPathInfo"]
                    },
                    associations: {
                        seoUrls: {},
                        media: {},
                        cover: {},
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
                        content: [{ type: "text", text: `No products found in category ${targetCategoryId}.` }]
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

                // Fetch Context for Currency
                let currencySymbol = "";
                try {
                    const contextRes = await client.get<any>("context");
                    currencySymbol = contextRes.currency?.symbol || "";
                } catch (e) {
                    console.warn("Failed to fetch context currency:", e);
                }

                const baseShopUrl = (args.shopUrl || "").replace(/\/$/, "");

                const products = response.elements.map((p: any) => {
                    let name = p.name ?? p.translated?.name;

                    if (!name && p.parentId) {
                        const parent = parents.get(p.parentId);
                        if (parent) {
                            name = parent.name ?? parent.translated?.name;
                        }
                    }
                    name = name ?? "Unknown";

                    const price = p.calculatedPrice?.totalPrice ? p.calculatedPrice.totalPrice : 0;

                    // Get cover image or first media image - ensure absolute URL
                    let imageUrl = p.cover?.media?.url || p.media?.[0]?.media?.url || null;
                    if (imageUrl && !imageUrl.startsWith('http') && baseShopUrl) {
                        imageUrl = `${baseShopUrl}/${imageUrl.replace(/^\//, '')}`;
                    }

                    // Get SEO URL slug
                    const seoUrl = p.seoUrls?.[0]?.seoPathInfo || `detail/${p.id}`;
                    const productUrl = baseShopUrl ? `${baseShopUrl}/${seoUrl}` : seoUrl;

                    return {
                        id: p.id,
                        name: name,
                        price: price,
                        formattedPrice: currencySymbol ? `${price} ${currencySymbol}` : `${price}`,
                        currency: currencySymbol,
                        url: productUrl,
                        imageUrl: imageUrl
                    };
                });

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            results: products,
                            searchTerm: `Category ID: ${args.categoryId}`,
                            pagination: {
                                total: response.total ?? products.length,
                                page: args.page,
                                limit: args.limit,
                                hasNextPage: (response.total ?? 0) > (args.page * args.limit)
                            }
                        }, null, 2)
                    }]
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
