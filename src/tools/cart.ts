import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StoreApiClient, StoreCredentialsSchema } from "../client.js";

export function registerCartTools(server: McpServer) {
    server.registerTool(
        "store_cart_get",
        {
            description: "View the current items in the customer's cart.",
            inputSchema: StoreCredentialsSchema.shape
        },
        async (args) => {
            const client = new StoreApiClient({
                swAccessKey: args.swAccessKey,
                swContextToken: args.swContextToken,
                swLanguageId: "2fbb5fe2e29a4d70aa5854ce7ce3e20b", // Hardcoded English Language ID
                shopUrl: args.shopUrl
            });

            const cart = await client.get<any>("checkout/cart");

            if (!cart.lineItems || cart.lineItems.length === 0) {
                return {
                    content: [{ type: "text", text: "The cart is currently empty." }]
                };
            }

            const items = cart.lineItems.map((item: any) => {
                return `- ${item.quantity}x ${item.label} (${item.type}) - ${item.price?.totalPrice || "N/A"}`;
            }).join("\n");

            return {
                content: [{ type: "text", text: `Current Cart (${cart.price?.totalPrice} total):\n${items}` }]
            };
        }
    );

    server.registerTool(
        "store_cart_add",
        {
            description: "Add a product to the cart.",
            inputSchema: StoreCredentialsSchema.merge(z.object({
                productId: z.string().describe("The UUID of the product to add"),
                quantity: z.number().default(1).describe("Quantity to add"),
            })).shape
        },
        async (args) => {
            const client = new StoreApiClient({
                swAccessKey: args.swAccessKey,
                swContextToken: args.swContextToken,
                swLanguageId: "2fbb5fe2e29a4d70aa5854ce7ce3e20b", // Hardcoded English Language ID
                shopUrl: args.shopUrl
            });

            // Store API expects: /checkout/cart/line-item
            // Body: { items: [ { type: 'product', referencedId: '...', quantity: 1 } ] }

            try {
                const response = await client.post<any>("checkout/cart/line-item", {
                    items: [
                        {
                            type: "product",
                            referencedId: args.productId,
                            quantity: args.quantity
                        }
                    ]
                });

                // Response is the updated cart
                const addedItem = response.lineItems.find((i: any) => i.referencedId === args.productId);

                return {
                    content: [{ type: "text", text: `Successfully added ${args.quantity}x product to cart. New cart total: ${response.price?.totalPrice}` }]
                };
            } catch (error) {
                return {
                    isError: true,
                    content: [{ type: "text", text: `Failed to add product to cart. Error: ${error}` }]
                };
            }
        }
    );
}
