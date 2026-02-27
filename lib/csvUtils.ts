export type ProductRow = {
    id: number;
    name: string;
    category: string;
    price: number;
    quantity: number;
    status: string;
    createdAt: Date;
};

export const CSV_HEADER = "id,name,category,price,quantity,status,createdAt\n";

export function rowToCsvLine(product: ProductRow): string {
    const escapeCsv = (val: string) => {
        if (val.includes(",") || val.includes('"') || val.includes("\n")) {
            return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
    };

    return [
        product.id,
        escapeCsv(product.name),
        escapeCsv(product.category),
        product.price.toFixed(2),
        product.quantity,
        escapeCsv(product.status),
        product.createdAt.toISOString(),
    ].join(",") + "\n";
}
