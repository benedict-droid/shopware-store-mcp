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
            description: "Search for products in the current store context. Supports sorting and price filtering.",
            inputSchema: StoreCredentialsSchema.merge(z.object({
                term: z.string().describe("Search keyword (e.g., 't-shirt', 'blue')"),
                limit: z.number().max(3).default(3).describe("Max number of products"),
                page: z.number().default(1).describe("The page number"),
                // ALLOW 'rating-desc' explicitly to prevent crashes if LLM guesses it
                sort: z.enum(["relevance", "price-asc", "price-desc", "rating", "rating-desc", "rating-asc", "name-asc", "name-desc"]).optional().describe("Sort order"),
                minPrice: z.number().optional().describe("Minimum price filter"),
                maxPrice: z.number().optional().describe("Maximum price filter")
            })).shape
        },
        async (args) => {
            console.log("Executing store_product_search with args:", args);
            const client = new StoreApiClient({
                swAccessKey: args.swAccessKey,
                swContextToken: args.swContextToken,
                swLanguageId: args.swLanguageId || "2fbb5fe2e29a4d70aa5854ce7ce3e20b",
                shopUrl: args.shopUrl
            });

            // Prepare sorting
            let order = undefined;
            if (args.sort) {
                switch (args.sort) {
                    case "price-asc": order = "price-asc"; break;
                    case "price-desc": order = "price-desc"; break;
                    case "name-asc": order = "name-asc"; break;
                    case "name-desc": order = "name-desc"; break;
                    // Fix: Map both to 'ratingAverage' to ensure Shopware sorts correctly
                    case "rating":
                    case "rating-desc":
                        order = "ratingAverage-desc";
                        break;
                    case "rating-asc":
                        order = "ratingAverage-asc";
                        break;
                }
            }

            // Prepare filtering (Range filter for price)
            // Prepare filtering (Range filter for price)
            const filters = [];
            if (args.minPrice !== undefined || args.maxPrice !== undefined) {
                const rangeParam: any = {};
                if (args.minPrice !== undefined) rangeParam.gte = args.minPrice;
                if (args.maxPrice !== undefined) rangeParam.lte = args.maxPrice;

                filters.push({
                    type: "range",
                    field: "price",
                    parameters: rangeParam
                });
            }

            // Fetch Context for Currency
            let currencySymbol = "";
            try {
                const contextRes = await client.get<any>("context");
                currencySymbol = contextRes.currency?.symbol || "";
            } catch (e) {
                console.warn("Failed to fetch context currency:", e);
            }

            // Using the /store-api/search endpoint
            const response = await client.post<any>("search", {
                search: args.term,
                limit: Math.min(args.limit, 3),
                page: args.page,
                order: order,
                filter: filters.length > 0 ? filters : undefined,
                includes: {
                    product: ["id", "productNumber", "name", "translated", "stock", "availableStock", "calculatedPrice", "parentId", "seoUrls", "media", "cover", "description"],
                    product_media: ["media"],
                    media: ["url"],
                    seo_url: ["seoPathInfo"]
                },
                associations: {
                    seoUrls: {},
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
            console.log("Executing store_product_detail with args:", args);
            const client = new StoreApiClient({
                swAccessKey: args.swAccessKey,
                swContextToken: args.swContextToken,
                swLanguageId: args.swLanguageId || "2fbb5fe2e29a4d70aa5854ce7ce3e20b",
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
                    deliveryTime: {}, // Request delivery time
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
                    // Fetch children for parents
                    children: {
                        associations: {
                            options: {
                                associations: {
                                    group: {}
                                }
                            }
                        }
                    },
                    categories: {} // <--- ADDED CATEGORIES ASSOCIATION
                }
            });

            if (!response.elements || response.elements.length === 0) {
                return { isError: true, content: [{ type: "text", text: `Product not found with ID: ${resolvedId}` }] };
            }

            // Fetch Context for Currency
            let currencySymbol = "";
            try {
                const contextRes = await client.get<any>("context");
                currencySymbol = contextRes.currency?.symbol || "";
            } catch (e) {
                console.error("DEBUG: Failed to fetch context currency:", e);
            }

            const p = response.elements[0];

            // ---------------------------------------------------------
            // VARIANT AGGREGATION LOGIC + PARENT DATA FETCHING
            // ---------------------------------------------------------
            let allVariants: any[] = [];
            let parent: any = null;

            // Case A: Current product is a variant (has parent)
            if (p.parentId) {
                try {
                    const parentRes = await client.post<any>("product", {
                        ids: [p.parentId],
                        associations: {
                            children: {
                                associations: {
                                    options: { associations: { group: {} } }
                                }
                            },
                            // Additional associations for inheriting parent data
                            media: {},
                            cover: {},
                            manufacturer: {},
                            categories: {},
                            seoUrls: {}
                        }
                    });
                    if (parentRes.elements?.[0]) {
                        parent = parentRes.elements[0];
                        allVariants = parent.children || [];
                    }
                } catch (e) {
                    console.error("Failed to fetch parent/siblings:", e);
                }
            }
            // Case B: Current product is a Parent (has children)
            else if (p.children && p.children.length > 0) {
                allVariants = p.children;
            }

            // ---------------------------------------------------------
            // APPLY PARENT DATA FALLBACKS FOR VARIANTS
            // ---------------------------------------------------------
            const price = p.calculatedPrice?.totalPrice || 0;

            // Fallback to parent description if variant has none
            const rawDescription = p.description || parent?.description;
            const description = rawDescription ? rawDescription.replace(/<[^>]*>?/gm, '') : null;

            // Aggregate Options from all siblings/children
            const availableOptions: Record<string, Set<string>> = {};

            // Helper to process a variant's options
            const processOptions = (variant: any) => {
                const opts = variant.properties || variant.options;
                if (!opts) return;

                opts.forEach((o: any) => {
                    const group = o.group?.name || o.group?.translated?.name;
                    const val = o.name || o.translated?.name;
                    if (group && val) {
                        if (!availableOptions[group]) availableOptions[group] = new Set();
                        availableOptions[group].add(val);
                    }
                });
            };

            // Process all variants found
            allVariants.forEach(processOptions);

            // Also process the current product itself (in case it's not in the children list or is the parent)
            processOptions(p);

            // Convert Sets to Arrays for JSON output
            const formattedAvailableOptions: Record<string, string[]> = {};
            Object.keys(availableOptions).forEach(k => {
                formattedAvailableOptions[k] = Array.from(availableOptions[k]);
            });

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
                description: description,
                price: price,
                formattedPrice: currencySymbol ? `${price} ${currencySymbol}` : `${price}`,
                currency: currencySymbol,
                manufacturer: p.manufacturer?.name || parent?.manufacturer?.name || null,
                deliveryTime: p.deliveryTime?.name || p.deliveryTime?.translated?.name || "Standard Delivery",
                stock: p.availableStock ?? 0,
                rating: p.ratingAverage ?? null,
                options: options,
                availableOptions: formattedAvailableOptions,
                // Enhanced Attributes
                material: p.properties?.find((prop: any) => prop.group?.name === "Material" || prop.group?.translated?.name === "Material")?.name
                    ?? p.customFields?.material ?? null,
                sustainability: p.properties?.find((prop: any) => prop.group?.name === "Sustainability" || prop.group?.translated?.name === "Sustainability")?.name
                    ?? p.customFields?.sustainability ?? null,
                dimensions: p.properties?.find((prop: any) => prop.group?.name === "Dimensions" || prop.group?.translated?.name === "Dimensions")?.name
                    ?? (p.width && p.height && p.length ? `${p.length}x${p.width}x${p.height} mm` : null),

                images: ((p.media && p.media.length > 0) ? p.media : (parent?.media || [])).map((m: any) => {
                    let url = m.media?.url;
                    if (url && !url.startsWith('http') && baseShopUrl) {
                        url = `${baseShopUrl}/${url.replace(/^\//, '')}`;
                    }
                    return url;
                }).filter(Boolean) || [],
                url: baseShopUrl ? `${baseShopUrl}/${p.seoUrls?.[0]?.seoPathInfo || `detail/${p.id}`}` : `detail/${p.id}`,
                categoryName: p.categories?.[0]?.name ?? p.categories?.[0]?.translated?.name ?? parent?.categories?.[0]?.name ?? parent?.categories?.[0]?.translated?.name ?? null
            };


            console.log("DEBUG: Product Detail Response:", JSON.stringify(productDetail, null, 2));

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(productDetail, null, 2)
                }]
            };
        }
    );
}
