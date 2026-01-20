import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StoreApiClient, StoreCredentialsSchema } from "../client.js";

// Helper to format currency
const formatPrice = (priceObj: any) => {
    if (!priceObj || !priceObj.totalPrice) return "N/A";
    return `${priceObj.totalPrice}`; // Simplified, real currency needs symbol
};

export function registerProductTools(server: McpServer) {
    server.registerTool(
        "store_product_search",
        {
            description: "Search for products in the current store context.",
            inputSchema: StoreCredentialsSchema.merge(z.object({
                term: z.string().describe("Search keyword (e.g., 't-shirt', 'blue')"),
                limit: z.number().max(3).default(3).describe("Max number of products to return (Max: 3)"),
                page: z.number().default(1).describe("The page number to retrieve"),
            })).shape
        },
        async (args) => {
            const client = new StoreApiClient({
                swAccessKey: args.swAccessKey,
                swContextToken: args.swContextToken,
                swLanguageId: "2fbb5fe2e29a4d70aa5854ce7ce3e20b", // Hardcoded English Language ID
                shopUrl: args.shopUrl
            });

            // Using the /store-api/search endpoint for optimized search
            const response = await client.post<any>("search", {
                search: args.term,
                limit: Math.min(args.limit, 3),
                page: args.page,
                includes: {
                    product: ["id", "productNumber", "name", "translated", "stock", "availableStock", "calculatedPrice", "parentId", "options", "properties", "availableStock", "seoUrls", "media", "cover"],
                    product_media: ["media"],
                    media: ["url"],
                    seo_url: ["seoPathInfo"]
                },
                associations: {
                    seoUrls: {},
                    properties: {
                        associations: {
                            group: {}
                        }
                    },
                    options: {
                        associations: {
                            group: {}
                        }
                    },
                    media: {},
                    cover: {}
                }
            });

            if (!response.elements || response.elements.length === 0) {
                return {
                    content: [{ type: "text", text: `No products found for search term: "${args.term}"` }]
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
                    console.error("Failed to fetch parents:", e);
                }
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

                const opts = p.properties && p.properties.length > 0 ? p.properties : p.options;
                const options = opts?.map((o: any) => ({
                    group: o.group?.name ?? o.group?.translated?.name,
                    option: o.name ?? o.translated?.name
                }));

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
                    productNumber: p.productNumber,
                    name: name,
                    price: price,
                    stock: p.availableStock ?? 0,
                    options: options,
                    imageUrl: imageUrl,
                    url: productUrl
                };
            });

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        results: products,
                        searchTerm: args.term,
                        pagination: {
                            total: response.total ?? products.length,
                            page: args.page,
                            limit: args.limit,
                            hasNextPage: (response.total ?? 0) > (args.page * args.limit)
                        }
                    }, null, 2)
                }]
            };
        }
    );

    server.registerTool(
        "store_product_detail",
        {
            description: "Get detailed information about a specific product by ID.",
            inputSchema: StoreCredentialsSchema.merge(z.object({
                productId: z.string().describe("The UUID of the product"),
            })).shape
        },
        async (args) => {
            const client = new StoreApiClient({
                swAccessKey: args.swAccessKey,
                swContextToken: args.swContextToken,
                swLanguageId: "2fbb5fe2e29a4d70aa5854ce7ce3e20b", // Hardcoded English Language ID
                shopUrl: args.shopUrl
            });

            // Resolve Product ID (handles SKU or UUID)
            const resolvedId = await client.resolveProductId(args.productId);
            if (!resolvedId) {
                return { isError: true, content: [{ type: "text", text: `Product not found: ${args.productId}` }] };
            }

            // Use post product with resolved ID
            const response = await client.post<any>("product", {
                ids: [resolvedId],
                limit: 1,
                associations: {
                    media: {},
                    cover: {},
                    manufacturer: {},
                    seoUrls: {},
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
                return { isError: true, content: [{ type: "text", text: `Product not found with ID: ${resolvedId}` }] };
            }

            const p = response.elements[0];
            const price = p.calculatedPrice?.totalPrice || 0;
            const description = p.description ? p.description.replace(/<[^>]*>?/gm, '') : null;

            const opts = p.properties && p.properties.length > 0 ? p.properties : p.options;
            const options = opts?.map((o: any) => ({
                group: o.group?.name ?? o.group?.translated?.name,
                option: o.name ?? o.translated?.name
            }));

            const baseShopUrl = (args.shopUrl || "").replace(/\/$/, "");
            const productDetail = {
                id: p.id,
                productNumber: p.productNumber,
                name: p.name ?? p.translated?.name,
                price: price,
                manufacturer: p.manufacturer?.name || null,
                stock: p.availableStock ?? 0,
                options: options,
                description: description,
                images: p.media?.map((m: any) => {
                    let url = m.media?.url;
                    if (url && !url.startsWith('http') && baseShopUrl) {
                        url = `${baseShopUrl}/${url.replace(/^\//, '')}`;
                    }
                    return url;
                }).filter(Boolean) || [],
                url: baseShopUrl ? `${baseShopUrl}/${p.seoUrls?.[0]?.seoPathInfo || `detail/${p.id}`}` : `detail/${p.id}`
            };

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(productDetail, null, 2)
                }]
            };
        }
    );
}
