import { createSpace, listSpaces } from "@/lib/repo";
import { handle, ok, parseBody } from "@/lib/http";
import { spaceCreateSchema } from "@/lib/validation";

export const GET = handle(async () => ok(await listSpaces()));

export const POST = handle(async (req: Request) => {
  const input = await parseBody(req, spaceCreateSchema);
  return ok(await createSpace(input), 201);
});
