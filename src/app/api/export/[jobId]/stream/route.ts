import { prisma } from "@/lib/prisma";
import { CSV_HEADER, rowToCsvLine } from "@/lib/csvUtils";

const CHUNK_SIZE = 1000;
const CHUNK_DELAY_MS = 50;

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ jobId: string }> }
) {
    const { jobId } = await params;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const send = (data: string) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };
            const sendEvent = (event: string, data: unknown) => {
                controller.enqueue(
                    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
                );
            };

            try {
                const job = await prisma.exportJob.findUnique({ where: { id: jobId } });
                if (!job) {
                    sendEvent("error", { message: "Job not found" });
                    controller.close();
                    return;
                }

                // Update job to PROCESSING
                await prisma.exportJob.update({
                    where: { id: jobId },
                    data: { status: "PROCESSING" },
                });

                const filters = JSON.parse(job.filters) as {
                    category: string;
                    status: string;
                    search: string;
                };

                const where: Record<string, unknown> = {};
                if (filters.category) where.category = filters.category;
                if (filters.status) where.status = filters.status;
                if (filters.search) where.name = { contains: filters.search };

                let cursor = job.lastCursor;
                let rowsExported = job.rowsExported;

                // Send CSV header as first chunk
                send(CSV_HEADER);

                while (true) {
                    const products = await prisma.product.findMany({
                        where: { ...where, id: { gt: cursor } },
                        orderBy: { id: "asc" },
                        take: CHUNK_SIZE,
                    });

                    if (products.length === 0) break;

                    const csvChunk = products.map(rowToCsvLine).join("");
                    send(csvChunk);

                    cursor = products[products.length - 1].id;
                    rowsExported += products.length;

                    // Persist progress for resumability
                    await prisma.exportJob.update({
                        where: { id: jobId },
                        data: {
                            lastCursor: cursor,
                            rowsExported,
                            status: "PROCESSING",
                        },
                    });

                    sendEvent("progress", { rowsExported, totalRows: job.totalRows });

                    // Throttle to avoid hammering DB
                    await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
                }

                // Mark done
                await prisma.exportJob.update({
                    where: { id: jobId },
                    data: { status: "DONE" },
                });

                sendEvent("done", { rowsExported });
            } catch (err) {
                console.error("Export stream error:", err);
                await prisma.exportJob
                    .update({
                        where: { id: jobId },
                        data: { status: "FAILED" },
                    })
                    .catch(() => { });
                sendEvent("error", { message: String(err) });
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        },
    });
}
