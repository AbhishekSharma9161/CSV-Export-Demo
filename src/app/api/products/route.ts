import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
    const pageSize = Math.min(
        100,
        Math.max(1, parseInt(searchParams.get("pageSize") ?? "50"))
    );
    const category = searchParams.get("category") ?? "";
    const status = searchParams.get("status") ?? "";
    const search = searchParams.get("search") ?? "";

    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (status) where.status = status;
    if (search) {
        where.name = { contains: search };
    }

    const [products, total] = await Promise.all([
        prisma.product.findMany({
            where,
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { id: "asc" },
        }),
        prisma.product.count({ where }),
    ]);

    return NextResponse.json({
        products,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
    });
}
