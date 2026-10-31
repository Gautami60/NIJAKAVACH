import { z } from "zod";

/**
 * Standard Indian and E.164 International Phone Regex
 * Complies with ITU-T E.164: + followed by 1 to 3 digit country code and 4 to 14 digits.
 */
export const E164PhoneRegex = /^\+[1-9]\d{1,14}$/;

/**
 * Validates strict E.164 phone numbers (e.g. +919876543210)
 */
export const E164PhoneSchema = z
  .string()
  .trim()
  .regex(E164PhoneRegex, {
    message: "Phone number must follow strict E.164 format (e.g., +919876543210)"
  });

/**
 * Standard Email Schema
 */
export const EmailSchema = z
  .string()
  .trim()
  .email({ message: "Invalid email address format" })
  .max(255);

/**
 * UUIDv4 Schema
 */
export const UuidSchema = z
  .string()
  .uuid({ message: "Identifier must be a valid UUIDv4" });

/**
 * Strong Password Schema
 */
export const PasswordSchema = z
  .string()
  .min(8, { message: "Password must be at least 8 characters long" })
  .max(128)
  .regex(/[A-Z]/, { message: "Password must contain at least one uppercase letter" })
  .regex(/[a-z]/, { message: "Password must contain at least one lowercase letter" })
  .regex(/[0-9]/, { message: "Password must contain at least one number" })
  .regex(/[^A-Za-z0-9]/, { message: "Password must contain at least one special character" });

/**
 * Standard Pagination Query Schema
 */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * Strict HTTP/HTTPS URL Schema (SSRF protection baseline)
 */
export const HttpUrlSchema = z
  .string()
  .trim()
  .url({ message: "Invalid URL format" })
  .max(512)
  .refine(
    (val) => {
      if (!val.startsWith("http://") && !val.startsWith("https://")) return false;
      const lower = val.toLowerCase();
      if (
        lower.includes("://localhost") ||
        lower.includes("://127.0.0.1") ||
        lower.includes("://::1") ||
        lower.includes("://169.254.169.254")
      ) {
        return false;
      }
      return true;
    },
    { message: "URL must be a public HTTP or HTTPS address" }
  );
