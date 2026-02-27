import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
    const body = await request.json();
    const filters = {
        category: body.category ?? "",
        status: body.status ?? "",
        search: body.search ?? "",
    };

    // Count how many rows match the filters
    const where: Record<string, unknown> = {};
    if (filters.category) where.category = filters.category;
    if (filters.status) where.status = filters.status;
    if (filters.search) where.name = { contains: filters.search };

    const totalRows = await prisma.product.count({ where });

    const job = await prisma.exportJob.create({
        data: {
            filters: JSON.stringify(filters),
            status: "PENDING",
            totalRows,
            lastCursor: 0,
            rowsExported: 0,
        },
    });

    return NextResponse.json({ jobId: job.id, totalRows });
}
