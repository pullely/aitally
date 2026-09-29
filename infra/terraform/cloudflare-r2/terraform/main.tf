terraform {
  required_version = ">= 1.15.0"

  # State lives on the platform (SB1): the runner exports TF_HTTP_* per job.
  backend "http" {}

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.30"
    }
    external = {
      source  = "hashicorp/external"
      version = "~> 2.3"
    }
  }
}

# --- Providers ---

# Authenticates via the CLOUDFLARE_API_TOKEN env var (provider-native): the
# token is an orun-managed secret resolved into the job env at run time, so it
# never transits Terraform variables.
provider "cloudflare" {}

# --- Variables (standard Orun parameters) ---

variable "cloudflare_account_id" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Cloudflare account ID (from CLOUDFLARE_ACCOUNT_ID env var)"
}

variable "orgName" {
  type    = string
  default = "sourceplane"
}

variable "owner" {
  type    = string
  default = "sourceplane"
}

variable "repo" {
  type    = string
  default = "aitally"
}

variable "namespace" {
  type    = string
  default = "sourceplane"
}

variable "namespacePrefix" {
  type    = string
  default = ""
}

variable "lane" {
  type    = string
  default = "verify"
}

variable "environment" {
  type    = string
  default = "stage"
}

variable "component" {
  type    = string
  default = "cloudflare-r2"
}

variable "stackName" {
  type    = string
  default = "cloudflare-r2"
}

variable "terraformDir" {
  type    = string
  default = "terraform"
}

variable "terraformVersion" {
  type    = string
  default = "1.15.3"
}

# --- R2 bucket for training content and evidence packs (AT2, AT3) ---
#
# One bucket per environment. Course material is keyed
# orgs/{org}/courses/{course}/materials/{material} and evidence packs
# orgs/{org}/packs/{pack}/{file}; every object is written once under a fresh
# id and its SHA-256 is recorded in D1. The bucket is private: every read goes
# through tally-worker, authorized by membership.

locals {
  # Brand-namespaced with var.repo, for the same reason the KV namespace is:
  # this fork shares a Cloudflare account with the baseline and with the other
  # products built from it, and bucket names are unique per account.
  training_content_bucket_name = "${var.namespacePrefix}${var.repo}-training-content-${var.environment}"
}

resource "cloudflare_r2_bucket" "training_content" {
  account_id = var.cloudflare_account_id
  name       = local.training_content_bucket_name
}

# --- Wiring manifest (BF5, via orun secrets) ---
# An R2 binding resolves by bucket NAME, not by an opaque id, so the wiring
# document carries the name the worker's wrangler template substitutes.

output "wiring" {
  description = "Wiring document for downstream deploy-time binding resolution (pushed to orun secrets)"
  value = jsonencode({
    training_content_bucket_name = cloudflare_r2_bucket.training_content.name
  })
}

output "training_content_bucket_name" {
  description = "Cloudflare R2 bucket holding training material and evidence packs"
  value       = cloudflare_r2_bucket.training_content.name
}
