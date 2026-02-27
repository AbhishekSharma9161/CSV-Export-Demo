import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CATEGORIES = [
    "Electronics",
    "Clothing",
    "Food",
    "Books",
    "Toys",
    "Sports",
    "Home",
    "Garden",
    "Automotive",
    "Health",
];
const STATUSES = ["active", "inactive", "discontinued"];
const NAMES_PREFIX = [
    "Ultra",
    "Mega",
    "Super",
    "Pro",
    "Elite",
    "Smart",
    "Eco",
    "Nano",
    "Turbo",
    "Alpha",
];
const NAMES_SUFFIX = [
    "Widget",
    "Gadget",
    "Device",
    "Tool",
    "Gear",
    "Kit",
    "System",
    "Unit",
    "Pack",
    "Set",
];

const TOTAL = 100_000;
const BATCH_SIZE = 500;

async function main() {
    console.log(`Seeding ${TOTAL.toLocaleString()} products...`);
    console.time("seed");

    const batches = Math.ceil(TOTAL / BATCH_SIZE);

    for (let b = 0; b < batches; b++) {
        const data = [];
        const offset = b * BATCH_SIZE;
        const count = Math.min(BATCH_SIZE, TOTAL - offset);

        for (let i = 0; i < count; i++) {
            const idx = offset + i;
            data.push({
                name: `${NAMES_PREFIX[idx % NAMES_PREFIX.length]} ${NAMES_SUFFIX[(idx + 3) % NAMES_SUFFIX.length]} ${idx + 1}`,
                category: CATEGORIES[idx % CATEGORIES.length],
                price: parseFloat((Math.random() * 999 + 1).toFixed(2)),
                quantity: Math.floor(Math.random() * 1000),
                status: STATUSES[idx % STATUSES.length],
            });
        }

        await prisma.product.createMany({ data });

        if ((b + 1) % 20 === 0) {
            process.stdout.write(
                `\r  ${((offset + count) / TOTAL * 100).toFixed(1)}% — ${(offset + count).toLocaleString()} rows`
            );
        }
    }

    console.log("\nDone!");
    console.timeEnd("seed");
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
