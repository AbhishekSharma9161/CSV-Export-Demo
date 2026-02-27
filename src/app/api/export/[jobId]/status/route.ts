import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ jobId: string }> }
) {
    const { jobId } = await params;

    const job = await prisma.exportJob.findUnique({ where: { id: jobId } });
    if (!job) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({
        jobId: job.id,
        status: job.status,
        rowsExported: job.rowsExported,
        totalRows: job.totalRows,
        lastCursor: job.lastCursor,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
    });
}
