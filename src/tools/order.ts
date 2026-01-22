import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StoreApiClient, StoreCredentialsSchema } from "../client.js";

export function registerOrderTools(server: McpServer) {
    server.registerTool(
        "store_order_list",
        {
            description: "List orders for the currently logged-in customer.",
            inputSchema: StoreCredentialsSchema.merge(z.object({
                limit: z.number().max(3).default(3).describe("Max number of orders to return (Max: 3)"),
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
            try {
                // POST /store-api/order with criteria
                const response = await client.post<any>("order", {
                    limit: Math.min(args.limit, 3),
                    page: args.page,
                    sort: [{ field: "orderDateTime", order: "DESC" }],
                    associations: {
                        lineItems: {},
                        stateMachineState: {}
                    }
                });

                const ordersList = response.orders?.elements || [];

                if (ordersList.length === 0 && args.page === 1) {
                    return {
                        content: [{ type: "text", text: "No orders found for this customer." }]
                    };
                }

                const orders = ordersList.map((o: any) => {
                    return {
                        orderNumber: o.orderNumber,
                        date: new Date(o.orderDateTime).toLocaleDateString(),
                        status: o.stateMachineState?.name || "Unknown",
                        total: o.price?.totalPrice || 0,
                        id: o.id
                    };
                });

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            results: orders,
                            pagination: {
                                total: response.orders?.total ?? orders.length,
                                page: args.page,
                                limit: args.limit,
                                hasNextPage: (response.orders?.total ?? 0) > (args.page * args.limit)
                            }
                        }, null, 2)
                    }]
                };

            } catch (error: any) {
                // If 403, usually means not logged in
                if (error.message && error.message.includes("403")) {
                    return {
                        isError: false, // Not a system error, just a state
                        content: [{ type: "text", text: "The user is currently NOT logged in. Please ask the user to log in to view their order history." }]
                    };
                }
                throw error;
            }
        }
    );

    server.registerTool(
        "store_order_create",
        {
            description: "Place an order from the current cart.",
            inputSchema: StoreCredentialsSchema.merge(z.object({
                comment: z.string().optional().describe("Optional comment for the order"),
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
                const response = await client.post<any>("checkout/order", {
                    customerComment: args.comment
                });

                return {
                    content: [{ type: "text", text: `Success! Order placed. Order Number: ${response.orderNumber} (ID: ${response.id})` }]
                };
            } catch (error: any) {
                // Handle Not Logged In
                if (error.message && error.message.includes("403")) {
                    return {
                        isError: false,
                        content: [{ type: "text", text: "The user is NOT logged in. You cannot place an order until the user logs in. Please ask them to log in." }]
                    };
                }

                return {
                    isError: true,
                    content: [{ type: "text", text: `Failed to place order. Ensure you have items in cart and are logged in. Error: ${error.message || error}` }]
                };
            }
        }
    );
}
