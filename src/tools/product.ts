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
                limit: z.number().default(5).describe("Max number of products to return"),
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
                limit: args.limit,
                includes: {
                    product: ["id", "productNumber", "name", "translated", "stock", "toalStock", "calculatedPrice", "parentId", "options", "properties", "availableStock"],
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

            const products = response.elements.map((p: any) => {
                let name = p.name ?? p.translated?.name;

                if (!name && p.parentId) {
                    const parent = parents.get(p.parentId);
                    if (parent) {
                        name = parent.name ?? parent.translated?.name;
                    }
                }
                name = name ?? "Unknown";

                // Use properties if options are empty (Shopware variants often use properties)
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
                content: [{ type: "text", text: `Found products for "${args.term}":\n${products}` }]
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
                    manufacturer: {},
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
            const price = p.calculatedPrice?.totalPrice || "N/A";
            const description = p.description ? p.description.replace(/<[^>]*>?/gm, '') : "No description available."; // Strip HTML

            // Extract properties/options
            const opts = p.properties && p.properties.length > 0 ? p.properties : p.options;
            const optionsStr = opts?.map((o: any) => {
                const group = o.group?.name ?? o.group?.translated?.name;
                const option = o.name ?? o.translated?.name;
                return group ? `${group}: ${option}` : option;
            }).join(" | ") || "None";

            const details = `
Product: ${p.name}
SKU: ${p.productNumber}
Price: ${price}
Manufacturer: ${p.manufacturer?.name || "Unknown"}
Available Stock: ${p.availableStock}
Features/Options: ${optionsStr}

Description:
${description}
            `.trim();

            return {
                content: [{ type: "text", text: details }]
            };
        }
    );
}
