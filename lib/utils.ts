import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { SQL, sql, AnyColumn, SQLChunk } from "drizzle-orm";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function jsonArrayContainsAny<T extends AnyColumn>(
  column: T,
  values: T["_"]["data"],
): SQL {
  return sql`
    EXISTS (
      SELECT 1
      FROM json_array_elements_text(${column}::json) AS elem
      WHERE elem = ANY(ARRAY[${sql.join(values as SQLChunk[], sql`,`)}])
    )
  `;
}

export function jsonArrayContains<T extends AnyColumn>(
  column: T,
  values: string[],
): SQL {
  return sql`
    (
      SELECT COUNT(*) = ${values.length}
      FROM json_array_elements_text(${column}::json) AS elem
      WHERE elem = ANY(ARRAY[${sql.join(values as SQLChunk[], sql`,`)}])
    )
  `;
}
