import { prisma } from "@/lib/prisma";

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ limited: boolean; retryAfter?: number }> {
  const now = new Date();
  const resetAt = new Date(Date.now() + windowMs);

  const row = await prisma.rateLimit.upsert({
    where: { key },
    create: { key, count: 1, resetAt },
    update: { count: { increment: 1 } },
  });

  if (row.resetAt < now) {
    await prisma.rateLimit.update({ where: { key }, data: { count: 1, resetAt } });
    return { limited: false };
  }

  if (row.count > limit) {
    const retryAfter = Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000);
    return { limited: true, retryAfter };
  }

  return { limited: false };
}
