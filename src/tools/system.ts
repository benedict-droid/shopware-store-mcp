import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StoreApiClient, StoreCredentialsSchema } from "../client.js";

export function registerSystemTools(server: McpServer) {
    server.registerTool(
        "store_get_shipping_methods",
        {
            description: "List available shipping methods.",
            inputSchema: StoreCredentialsSchema.merge(z.object({
                onlyAvailable: z.boolean().default(true).describe("Show only available methods"),
            })).shape
        },
        async (args) => {
            const client = new StoreApiClient({
                swAccessKey: args.swAccessKey,
                swContextToken: args.swContextToken,
                swLanguageId: "2fbb5fe2e29a4d70aa5854ce7ce3e20b", // Hardcoded English Language ID
                shopUrl: args.shopUrl
            });

            try {
                const response = await client.post<any>("shipping-method", {
                    onlyAvailable: args.onlyAvailable,
                    includes: {
                        shipping_method: ["id", "name", "description", "prices", "media"]
                    }
                });

                if (!response.elements || response.elements.length === 0) {
                    return {
                        content: [{ type: "text", text: "No shipping methods available." }]
                    };
                }

                const methods = response.elements.map((m: any) => {
                    const name = m.name || "Unknown";
                    const desc = m.description || "";
                    return `- ${name}: ${desc}`;
                }).join("\n");

                return {
                    content: [{ type: "text", text: `Shipping Methods:\n${methods}` }]
                };

            } catch (error) {
                console.error("Failed to fetch shipping methods:", error);
                return {
                    isError: true,
                    content: [{ type: "text", text: "Failed to fetch shipping methods." }]
                };
            }
        }
    );

    server.registerTool(
        "store_get_payment_methods",
        {
            description: "List available payment methods.",
            inputSchema: StoreCredentialsSchema.merge(z.object({
                onlyAvailable: z.boolean().default(true).describe("Show only available methods"),
            })).shape
        },
        async (args) => {
            const client = new StoreApiClient({
                swAccessKey: args.swAccessKey,
                swContextToken: args.swContextToken,
                swLanguageId: "2fbb5fe2e29a4d70aa5854ce7ce3e20b", // Hardcoded English Language ID
                shopUrl: args.shopUrl
            });

            try {
                const response = await client.post<any>("payment-method", {
                    onlyAvailable: args.onlyAvailable,
                    includes: {
                        payment_method: ["id", "name", "description", "media"]
                    }
                });

                if (!response.elements || response.elements.length === 0) {
                    return {
                        content: [{ type: "text", text: "No payment methods available." }]
                    };
                }

                const methods = response.elements.map((m: any) => {
                    const name = m.name || "Unknown";
                    const desc = m.description || "";
                    return `- ${name}: ${desc}`;
                }).join("\n");

                return {
                    content: [{ type: "text", text: `Payment Methods:\n${methods}` }]
                };

            } catch (error) {
                console.error("Failed to fetch payment methods:", error);
                return {
                    isError: true,
                    content: [{ type: "text", text: "Failed to fetch payment methods." }]
                };
            }
        }
    );
}
