import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "@fastify/helmet";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/global-exception.filter";
import { useLenientJsonBodyParser } from "./common/fastify-json.parser";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, bodyLimit: 5 * 1024 * 1024 }),
    { abortOnError: false },
  );

  const config = app.get(ConfigService);
  const corsOrigin = config.get<string>("CORS_ORIGIN") ?? "http://localhost:5173";
  const port = parseInt(config.get("PORT") ?? "3000", 10);
  const host = config.get<string>("HOST") ?? "0.0.0.0";

  // Security headers: X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  // HSTS (when https). CSP stays disabled because the SPA calls this API from a
  // different origin (CORS); enable it with your own directives when serving
  // the API and SPA from the same origin.
  await app.register(helmet, { contentSecurityPolicy: false });

  app.enableCors({
    origin: corsOrigin.split(",").map((s) => s.trim()),
    credentials: true,
    allowedHeaders: [
      "content-type",
      "authorization",
      "x-organization-id",
      "idempotency-key",
      "x-request-id",
    ],
    exposedHeaders: ["x-request-id"],
  });

  // Consistent machine-readable error shape.
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Swagger / OpenAPI.
  const swaggerConfig = new DocumentBuilder()
    .setTitle("FlowForge API")
    .setDescription(
      "Multi-tenant workflow and asynchronous job orchestration. " +
        "All organization-scoped endpoints require the `X-Organization-Id` header " +
        "in addition to a bearer access token. Create API keys under a project to " +
        "trigger workflows from services.",
    )
    .setVersion("1.0.0")
    .addBearerAuth(
      { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      "access-token",
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // Override NestJS's default JSON parser so that bodyless POST requests with
  // Content-Type: application/json (e.g. run retry/cancel from the SPA) are
  // accepted rather than rejected with a 500. Empty bodies parse to {}.
  await app.init();
  useLenientJsonBodyParser(app);

  await app.listen(port, host);
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      msg: `FlowForge API listening on http://${host}:${port}`,
      swagger: `http://localhost:${port}/api/docs`,
      service: "flowforge-api",
    }),
  );
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
