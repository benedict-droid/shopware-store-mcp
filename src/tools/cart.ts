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

            try {
                const cart = await client.get<any>("checkout/cart");

                if (!cart.lineItems || cart.lineItems.length === 0) {
                    return {
                        content: [{ type: "text", text: "The cart is currently empty." }]
                    };
                }


                const cartItems = cart.lineItems.map((item: any) => {
                    return {
                        id: item.referencedId,
                        name: item.label,
                        quantity: item.quantity,
                        price: item.price?.totalPrice || 0,
                        unitPrice: item.price?.unitPrice || 0,
                        type: item.type,
                        imageUrl: item.cover?.url || null,
                        productNumber: item.payload?.productNumber || null
                    };
                });

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            results: cartItems,
                            total: cart.price?.totalPrice || 0,
                            summary: `Total Items: ${cartItems.length} | Total Price: ${cart.price?.totalPrice}`
                        }, null, 2)
                    }]
                };
            } catch (error: any) {
                if (error.message && error.message.includes("403")) {
                    return {
                        isError: false,
                        content: [{ type: "text", text: "Unable to access cart. The user might not be logged in or the session is invalid. Please ask the user to log in." }]
                    };
                }
                throw error;
            }
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
            } catch (error: any) {
                if (error.message && error.message.includes("403")) {
                    return {
                        isError: false,
                        content: [{ type: "text", text: "Unable to add to cart. The user is not logged in. Please ask the user to log in first." }]
                    };
                }
                return {
                    isError: true,
                    content: [{ type: "text", text: `Failed to add product to cart. Error: ${error.message || error}` }]
                };
            }
        }
    );
}
