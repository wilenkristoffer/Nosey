const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node')
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base')
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http')
const { resourceFromAttributes } = require('@opentelemetry/resources')
const { trace } = require('@opentelemetry/api')
const config = require('./config')

function setupTelemetry() {
  const exporter = new OTLPTraceExporter({ url: config.telemetry.otlpUrl })
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': config.telemetry.serviceName }),
    spanProcessors: [
      new BatchSpanProcessor(exporter, { exportTimeoutMillis: config.telemetry.exportTimeoutMs }),
    ],
  })
  provider.register()
  return trace.getTracer(config.telemetry.serviceName)
}

module.exports = { setupTelemetry }
