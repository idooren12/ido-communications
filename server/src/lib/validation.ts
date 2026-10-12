import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

/** A finite number. Accepts numeric strings too, since older clients sent them. */
const finite = () =>
  z.preprocess(
    value => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
    z.number({ invalid_type_error: 'must be a number' }).finite()
  );

export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

/** bcrypt ignores everything after 72 bytes, so longer passwords would be silently truncated. */
const password = z
  .string()
  .min(6, 'Password must be at least 6 characters')
  .refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 bytes');

export const credentialsSchema = z.object({
  username: z.string().regex(USERNAME_REGEX, 'Username must be 3-20 characters (letters, numbers, underscore)'),
  password,
});

export const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
});

export const preferencesSchema = z.object({
  preferredLanguage: z.enum(['he', 'en']),
});

const antennaFields = {
  name: z.string().trim().min(1).max(100),
  powerWatts: finite().pipe(z.number().positive().max(1e7)),
  gainDbi: finite().pipe(z.number().min(-100).max(100)),
  frequencyMhz: finite().pipe(z.number().positive().max(3e6)).nullable(),
  notes: z.string().max(2000).nullable(),
};

export const createAntennaSchema = z.object({
  name: antennaFields.name,
  powerWatts: antennaFields.powerWatts,
  gainDbi: antennaFields.gainDbi,
  frequencyMhz: antennaFields.frequencyMhz.optional(),
  notes: antennaFields.notes.optional(),
});

export const updateAntennaSchema = createAntennaSchema.partial();

export const calculationSchema = z.object({
  mode: z.enum(['distance', 'power']),
  txPowerWatts: finite(),
  txGainDbi: finite(),
  rxGainDbi: finite(),
  frequencyMhz: finite(),
  sensitivity: finite().nullable().optional(),
  distance: finite().nullable().optional(),
  resultValue: finite(),
});

export const weatherQuerySchema = z.object({
  lat: finite().pipe(z.number().min(-90).max(90)),
  lon: finite().pipe(z.number().min(-180).max(180)),
});

/** Express middleware: validates req.body and replaces it with the parsed (typed, trimmed) value. */
export function validateBody(schema: z.ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      res.status(400).json({ error: formatZodError(result.error) });
      return;
    }
    req.body = result.data;
    next();
  };
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map(issue => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}
