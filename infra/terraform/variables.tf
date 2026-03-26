variable "project_id" {
  description = "The GCP Project ID"
  type        = string
  default     = "sm-gemini-playground"
}

variable "region" {
  description = "The GCP region"
  type        = string
  default     = "europe-north1"
}

variable "task_region" {
  description = "Cloud Task Region"
  type = string
  default = "europe-west1"
}
variable "app_name" {
  description = "The name of the application"
  type        = string
  default     = "med-voice"
}

variable "image_uri" {
  description = "Container image URI for the backend service"
  type        = string
  default     = "gcr.io/sm-gemini-playground/med-voice-backend:latest"
}

variable "service_url" {
  description = "URL of the deployed Cloud Run service"
  type        = string
  default     = "https://med-voice-backend-979008310984.europe-north1.run.app"
}

variable "cors_allowed_origins" {
  description = "Comma-separated CORS allowlist for the backend"
  type        = string
  default     = "http://localhost:3000,https://med-voice--sm-gemini-playground.europe-west4.hosted.app"
}

variable "callback_queue_name" {
  description = "Cloud Tasks queue name for patient callbacks"
  type        = string
  default     = "med-voice-callback-queue-v2"
}

variable "twilio_from_number" {
  description = "Twilio caller ID in E.164 format"
  type        = string
  default     = "+15012904930"
}
