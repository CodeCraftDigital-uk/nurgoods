export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_generation_runs: {
        Row: {
          completed_at: string | null
          cost_usd: number | null
          created_at: string
          created_by: string | null
          entity_id: string | null
          entity_type: string | null
          error_message: string | null
          id: string
          input: Json
          model: string | null
          output: Json
          prompt_version_id: string | null
          provider: string | null
          stage: Database["public"]["Enums"]["workflow_stage"]
          started_at: string | null
          status: Database["public"]["Enums"]["run_status"]
          token_input: number | null
          token_output: number | null
          updated_at: string
          used_live_research: boolean
        }
        Insert: {
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          id?: string
          input?: Json
          model?: string | null
          output?: Json
          prompt_version_id?: string | null
          provider?: string | null
          stage: Database["public"]["Enums"]["workflow_stage"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["run_status"]
          token_input?: number | null
          token_output?: number | null
          updated_at?: string
          used_live_research?: boolean
        }
        Update: {
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          id?: string
          input?: Json
          model?: string | null
          output?: Json
          prompt_version_id?: string | null
          provider?: string | null
          stage?: Database["public"]["Enums"]["workflow_stage"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["run_status"]
          token_input?: number | null
          token_output?: number | null
          updated_at?: string
          used_live_research?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ai_generation_runs_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      article_briefs: {
        Row: {
          angle: string | null
          audience: string | null
          created_at: string
          created_by: string | null
          id: string
          key_questions: Json
          notes: string | null
          outline: Json
          related_product_ids: string[]
          requires_live_research: boolean
          search_intent: string | null
          stage: Database["public"]["Enums"]["workflow_stage"]
          status: Database["public"]["Enums"]["workflow_status"]
          target_query: string | null
          title: string
          updated_at: string
        }
        Insert: {
          angle?: string | null
          audience?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          key_questions?: Json
          notes?: string | null
          outline?: Json
          related_product_ids?: string[]
          requires_live_research?: boolean
          search_intent?: string | null
          stage?: Database["public"]["Enums"]["workflow_stage"]
          status?: Database["public"]["Enums"]["workflow_status"]
          target_query?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          angle?: string | null
          audience?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          key_questions?: Json
          notes?: string | null
          outline?: Json
          related_product_ids?: string[]
          requires_live_research?: boolean
          search_intent?: string | null
          stage?: Database["public"]["Enums"]["workflow_stage"]
          status?: Database["public"]["Enums"]["workflow_status"]
          target_query?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      article_internal_links: {
        Row: {
          accepted: boolean
          anchor_text: string
          article_id: string
          created_at: string
          id: string
          rationale: string | null
          target_reference: string
          target_type: Database["public"]["Enums"]["seo_target_type"]
          updated_at: string
        }
        Insert: {
          accepted?: boolean
          anchor_text: string
          article_id: string
          created_at?: string
          id?: string
          rationale?: string | null
          target_reference: string
          target_type: Database["public"]["Enums"]["seo_target_type"]
          updated_at?: string
        }
        Update: {
          accepted?: boolean
          anchor_text?: string
          article_id?: string
          created_at?: string
          id?: string
          rationale?: string | null
          target_reference?: string
          target_type?: Database["public"]["Enums"]["seo_target_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_internal_links_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_sources: {
        Row: {
          accessed_at: string
          article_id: string
          author: string | null
          created_at: string
          excerpt: string | null
          id: string
          published_date: string | null
          publisher: string | null
          title: string | null
          updated_at: string
          url: string
          verification_notes: string | null
          verified: boolean
        }
        Insert: {
          accessed_at?: string
          article_id: string
          author?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          published_date?: string | null
          publisher?: string | null
          title?: string | null
          updated_at?: string
          url: string
          verification_notes?: string | null
          verified?: boolean
        }
        Update: {
          accessed_at?: string
          article_id?: string
          author?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          published_date?: string | null
          publisher?: string | null
          title?: string | null
          updated_at?: string
          url?: string
          verification_notes?: string | null
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "article_sources_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          author_name: string | null
          body_markdown: string
          brief_id: string | null
          canonical_url: string | null
          created_at: string
          created_by: string | null
          excerpt: string | null
          faqs: Json
          hero_image_alt: string | null
          hero_image_url: string | null
          id: string
          meta_description: string | null
          meta_title: string | null
          published_at: string | null
          reading_minutes: number | null
          scheduled_for: string | null
          schema_type: string
          slug: string
          sources_verified: boolean
          stage: Database["public"]["Enums"]["workflow_stage"]
          status: Database["public"]["Enums"]["workflow_status"]
          structured_data: Json
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          author_name?: string | null
          body_markdown?: string
          brief_id?: string | null
          canonical_url?: string | null
          created_at?: string
          created_by?: string | null
          excerpt?: string | null
          faqs?: Json
          hero_image_alt?: string | null
          hero_image_url?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          published_at?: string | null
          reading_minutes?: number | null
          scheduled_for?: string | null
          schema_type?: string
          slug: string
          sources_verified?: boolean
          stage?: Database["public"]["Enums"]["workflow_stage"]
          status?: Database["public"]["Enums"]["workflow_status"]
          structured_data?: Json
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          author_name?: string | null
          body_markdown?: string
          brief_id?: string | null
          canonical_url?: string | null
          created_at?: string
          created_by?: string | null
          excerpt?: string | null
          faqs?: Json
          hero_image_alt?: string | null
          hero_image_url?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          published_at?: string | null
          reading_minutes?: number | null
          scheduled_for?: string | null
          schema_type?: string
          slug?: string
          sources_verified?: boolean
          stage?: Database["public"]["Enums"]["workflow_stage"]
          status?: Database["public"]["Enums"]["workflow_status"]
          structured_data?: Json
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "articles_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "article_briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_jobs: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          job_key: string
          job_type: string
          label: string
          last_result: Json
          last_run_at: string | null
          last_status: Database["public"]["Enums"]["run_status"] | null
          next_run_at: string | null
          requires_integration: string | null
          schedule_cron: string | null
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          job_key: string
          job_type: string
          label: string
          last_result?: Json
          last_run_at?: string | null
          last_status?: Database["public"]["Enums"]["run_status"] | null
          next_run_at?: string | null
          requires_integration?: string | null
          schedule_cron?: string | null
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          job_key?: string
          job_type?: string
          label?: string
          last_result?: Json
          last_run_at?: string | null
          last_status?: Database["public"]["Enums"]["run_status"] | null
          next_run_at?: string | null
          requires_integration?: string | null
          schedule_cron?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          created_at: string
          details: Json
          entity_id: string | null
          finished_at: string | null
          id: string
          job_key: string
          message: string | null
          run_key: string
          started_at: string
          status: Database["public"]["Enums"]["run_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          details?: Json
          entity_id?: string | null
          finished_at?: string | null
          id?: string
          job_key: string
          message?: string | null
          run_key: string
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          details?: Json
          entity_id?: string | null
          finished_at?: string | null
          id?: string
          job_key?: string
          message?: string | null
          run_key?: string
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          updated_at?: string
        }
        Relationships: []
      }
      catalogue_categories: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          is_fallback: boolean
          keywords: string[]
          name: string
          parent_id: string | null
          slug: string
          sort_order: number
          synonyms: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          is_fallback?: boolean
          keywords?: string[]
          name: string
          parent_id?: string | null
          slug: string
          sort_order?: number
          synonyms?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          is_fallback?: boolean
          keywords?: string[]
          name?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
          synonyms?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogue_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "catalogue_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      commerce_order_events: {
        Row: {
          code: string | null
          created_at: string
          detail: Json
          from_state: string | null
          id: string
          message: string | null
          order_id: string
          to_state: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          detail?: Json
          from_state?: string | null
          id?: string
          message?: string | null
          order_id: string
          to_state: string
        }
        Update: {
          code?: string | null
          created_at?: string
          detail?: Json
          from_state?: string | null
          id?: string
          message?: string | null
          order_id?: string
          to_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "commerce_order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "commerce_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      commerce_order_lines: {
        Row: {
          created_at: string
          id: string
          order_id: string
          quantity: number
          shopify_line_item_id: string
          shopify_product_id: string | null
          shopify_variant_id: string | null
          sku: string | null
          supplier_only: boolean
          supplier_status: string | null
          title: string | null
          tracking_number: string | null
          unit_price: number | null
          updated_at: string
          zendrop_line_item_id: string | null
          zendrop_product_id: string | null
          zendrop_store_line_item_id: string | null
          zendrop_variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          quantity?: number
          shopify_line_item_id: string
          shopify_product_id?: string | null
          shopify_variant_id?: string | null
          sku?: string | null
          supplier_only?: boolean
          supplier_status?: string | null
          title?: string | null
          tracking_number?: string | null
          unit_price?: number | null
          updated_at?: string
          zendrop_line_item_id?: string | null
          zendrop_product_id?: string | null
          zendrop_store_line_item_id?: string | null
          zendrop_variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          quantity?: number
          shopify_line_item_id?: string
          shopify_product_id?: string | null
          shopify_variant_id?: string | null
          sku?: string | null
          supplier_only?: boolean
          supplier_status?: string | null
          title?: string | null
          tracking_number?: string | null
          unit_price?: number | null
          updated_at?: string
          zendrop_line_item_id?: string | null
          zendrop_product_id?: string | null
          zendrop_store_line_item_id?: string | null
          zendrop_variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commerce_order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "commerce_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      commerce_orders: {
        Row: {
          actual_gross_payment: number | null
          actual_payment_fee: number | null
          actual_payout: number | null
          actual_supplier_cost_settlement: number | null
          actual_supplier_cost_source: number | null
          created_at: string
          currency: string | null
          delivered_at: string | null
          dispatch_idempotency_key: string | null
          economics_note: string | null
          forecast_margin: number | null
          forecast_profit: number | null
          fulfilment_cost: number | null
          fulfilment_mode: string | null
          gross_margin: number | null
          id: string
          last_error: string | null
          line_count: number
          lines_linked_at: string | null
          orchestration_state: string
          order_total: number | null
          paid_at: string | null
          preview_at: string | null
          preview_is_credit_redeem: boolean
          preview_payload: Json | null
          preview_reference: string | null
          preview_scope: string | null
          product_cost: number | null
          profit_variance: number | null
          realised_fx_rate: number | null
          realised_margin: number | null
          realised_profit: number | null
          retry_count: number
          shipped_at: string | null
          shipping_city: string | null
          shipping_cost: number | null
          shipping_country: string | null
          shopify_financial_status: string | null
          shopify_fulfillment_status: string | null
          shopify_order_id: string
          shopify_order_name: string | null
          shopify_order_number: number | null
          submitted_at: string | null
          supplier_currency: string | null
          supplier_fees: number | null
          supplier_payment_amount: number | null
          supplier_payment_currency: string | null
          supplier_product_cost: number | null
          supplier_shipping_cost: number | null
          supplier_status: string | null
          supplier_total: number | null
          tracking_carrier: string | null
          tracking_number: string | null
          tracking_url: string | null
          updated_at: string
          zendrop_fulfillment_operation_id: string | null
          zendrop_order_id: number | null
          zendrop_order_number: string | null
          zendrop_store_id: number | null
        }
        Insert: {
          actual_gross_payment?: number | null
          actual_payment_fee?: number | null
          actual_payout?: number | null
          actual_supplier_cost_settlement?: number | null
          actual_supplier_cost_source?: number | null
          created_at?: string
          currency?: string | null
          delivered_at?: string | null
          dispatch_idempotency_key?: string | null
          economics_note?: string | null
          forecast_margin?: number | null
          forecast_profit?: number | null
          fulfilment_cost?: number | null
          fulfilment_mode?: string | null
          gross_margin?: number | null
          id?: string
          last_error?: string | null
          line_count?: number
          lines_linked_at?: string | null
          orchestration_state?: string
          order_total?: number | null
          paid_at?: string | null
          preview_at?: string | null
          preview_is_credit_redeem?: boolean
          preview_payload?: Json | null
          preview_reference?: string | null
          preview_scope?: string | null
          product_cost?: number | null
          profit_variance?: number | null
          realised_fx_rate?: number | null
          realised_margin?: number | null
          realised_profit?: number | null
          retry_count?: number
          shipped_at?: string | null
          shipping_city?: string | null
          shipping_cost?: number | null
          shipping_country?: string | null
          shopify_financial_status?: string | null
          shopify_fulfillment_status?: string | null
          shopify_order_id: string
          shopify_order_name?: string | null
          shopify_order_number?: number | null
          submitted_at?: string | null
          supplier_currency?: string | null
          supplier_fees?: number | null
          supplier_payment_amount?: number | null
          supplier_payment_currency?: string | null
          supplier_product_cost?: number | null
          supplier_shipping_cost?: number | null
          supplier_status?: string | null
          supplier_total?: number | null
          tracking_carrier?: string | null
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
          zendrop_fulfillment_operation_id?: string | null
          zendrop_order_id?: number | null
          zendrop_order_number?: string | null
          zendrop_store_id?: number | null
        }
        Update: {
          actual_gross_payment?: number | null
          actual_payment_fee?: number | null
          actual_payout?: number | null
          actual_supplier_cost_settlement?: number | null
          actual_supplier_cost_source?: number | null
          created_at?: string
          currency?: string | null
          delivered_at?: string | null
          dispatch_idempotency_key?: string | null
          economics_note?: string | null
          forecast_margin?: number | null
          forecast_profit?: number | null
          fulfilment_cost?: number | null
          fulfilment_mode?: string | null
          gross_margin?: number | null
          id?: string
          last_error?: string | null
          line_count?: number
          lines_linked_at?: string | null
          orchestration_state?: string
          order_total?: number | null
          paid_at?: string | null
          preview_at?: string | null
          preview_is_credit_redeem?: boolean
          preview_payload?: Json | null
          preview_reference?: string | null
          preview_scope?: string | null
          product_cost?: number | null
          profit_variance?: number | null
          realised_fx_rate?: number | null
          realised_margin?: number | null
          realised_profit?: number | null
          retry_count?: number
          shipped_at?: string | null
          shipping_city?: string | null
          shipping_cost?: number | null
          shipping_country?: string | null
          shopify_financial_status?: string | null
          shopify_fulfillment_status?: string | null
          shopify_order_id?: string
          shopify_order_name?: string | null
          shopify_order_number?: number | null
          submitted_at?: string | null
          supplier_currency?: string | null
          supplier_fees?: number | null
          supplier_payment_amount?: number | null
          supplier_payment_currency?: string | null
          supplier_product_cost?: number | null
          supplier_shipping_cost?: number | null
          supplier_status?: string | null
          supplier_total?: number | null
          tracking_carrier?: string | null
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
          zendrop_fulfillment_operation_id?: string | null
          zendrop_order_id?: number | null
          zendrop_order_number?: string | null
          zendrop_store_id?: number | null
        }
        Relationships: []
      }
      commerce_settings: {
        Row: {
          allow_supplier_credit: boolean
          auto_fulfilment_enabled: boolean
          created_at: string
          id: string
          max_orders_per_run: number
          safe_test_order_ids: string[]
          updated_at: string
        }
        Insert: {
          allow_supplier_credit?: boolean
          auto_fulfilment_enabled?: boolean
          created_at?: string
          id?: string
          max_orders_per_run?: number
          safe_test_order_ids?: string[]
          updated_at?: string
        }
        Update: {
          allow_supplier_credit?: boolean
          auto_fulfilment_enabled?: boolean
          created_at?: string
          id?: string
          max_orders_per_run?: number
          safe_test_order_ids?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      commerce_webhook_deliveries: {
        Row: {
          attempts: number
          id: string
          last_error: string | null
          processed_at: string | null
          received_at: string
          shopify_order_id: string | null
          status: string
          topic: string | null
          updated_at: string
          webhook_id: string
        }
        Insert: {
          attempts?: number
          id?: string
          last_error?: string | null
          processed_at?: string | null
          received_at?: string
          shopify_order_id?: string | null
          status?: string
          topic?: string | null
          updated_at?: string
          webhook_id: string
        }
        Update: {
          attempts?: number
          id?: string
          last_error?: string | null
          processed_at?: string | null
          received_at?: string
          shopify_order_id?: string | null
          status?: string
          topic?: string | null
          updated_at?: string
          webhook_id?: string
        }
        Relationships: []
      }
      contact_enquiries: {
        Row: {
          category: string
          content_hash: string | null
          created_at: string
          delivery_error: string | null
          email: string
          email_attempted_at: string | null
          handled: boolean
          id: string
          ip_hash: string | null
          message: string
          name: string
          order_number: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          category: string
          content_hash?: string | null
          created_at?: string
          delivery_error?: string | null
          email: string
          email_attempted_at?: string | null
          handled?: boolean
          id?: string
          ip_hash?: string | null
          message: string
          name: string
          order_number?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          category?: string
          content_hash?: string | null
          created_at?: string
          delivery_error?: string | null
          email?: string
          email_attempted_at?: string | null
          handled?: boolean
          id?: string
          ip_hash?: string | null
          message?: string
          name?: string
          order_number?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      content_entries: {
        Row: {
          body: Json
          created_at: string
          created_by: string | null
          entry_type: string
          id: string
          published_at: string | null
          slug: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: Json
          created_at?: string
          created_by?: string | null
          entry_type: string
          id?: string
          published_at?: string | null
          slug: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: Json
          created_at?: string
          created_by?: string | null
          entry_type?: string
          id?: string
          published_at?: string | null
          slug?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      duplicate_audit_events: {
        Row: {
          actor: string | null
          created_at: string
          detail: Json
          event_type: string
          group_id: string | null
          id: string
          product_id: string | null
        }
        Insert: {
          actor?: string | null
          created_at?: string
          detail?: Json
          event_type: string
          group_id?: string | null
          id?: string
          product_id?: string | null
        }
        Update: {
          actor?: string | null
          created_at?: string
          detail?: Json
          event_type?: string
          group_id?: string | null
          id?: string
          product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "duplicate_audit_events_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "duplicate_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      duplicate_group_members: {
        Row: {
          available: boolean | null
          created_at: string
          evidence: Json
          group_id: string
          id: string
          match_score: number | null
          price: number | null
          product_id: string
          quality_score: number | null
          role: string
          suppressed: boolean
          updated_at: string
        }
        Insert: {
          available?: boolean | null
          created_at?: string
          evidence?: Json
          group_id: string
          id?: string
          match_score?: number | null
          price?: number | null
          product_id: string
          quality_score?: number | null
          role?: string
          suppressed?: boolean
          updated_at?: string
        }
        Update: {
          available?: boolean | null
          created_at?: string
          evidence?: Json
          group_id?: string
          id?: string
          match_score?: number | null
          price?: number | null
          product_id?: string
          quality_score?: number | null
          role?: string
          suppressed?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "duplicate_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "duplicate_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duplicate_group_members_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
        ]
      }
      duplicate_groups: {
        Row: {
          admin_decision: string
          admin_note: string | null
          auto_suppressed: boolean
          canonical_handle: string | null
          canonical_product_id: string | null
          confidence: number
          confidence_tier: string
          created_at: string
          evidence: Json
          group_key: string
          id: string
          last_elected_at: string | null
          last_evaluated_at: string | null
          member_count: number
          price_spread: number | null
          suppressed_count: number
          updated_at: string
        }
        Insert: {
          admin_decision?: string
          admin_note?: string | null
          auto_suppressed?: boolean
          canonical_handle?: string | null
          canonical_product_id?: string | null
          confidence?: number
          confidence_tier?: string
          created_at?: string
          evidence?: Json
          group_key: string
          id?: string
          last_elected_at?: string | null
          last_evaluated_at?: string | null
          member_count?: number
          price_spread?: number | null
          suppressed_count?: number
          updated_at?: string
        }
        Update: {
          admin_decision?: string
          admin_note?: string | null
          auto_suppressed?: boolean
          canonical_handle?: string | null
          canonical_product_id?: string | null
          confidence?: number
          confidence_tier?: string
          created_at?: string
          evidence?: Json
          group_key?: string
          id?: string
          last_elected_at?: string | null
          last_evaluated_at?: string | null
          member_count?: number
          price_spread?: number | null
          suppressed_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "duplicate_groups_canonical_product_id_fkey"
            columns: ["canonical_product_id"]
            isOneToOne: false
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_plan_items: {
        Row: {
          angle: string | null
          article_id: string | null
          attempts: number
          audience: string | null
          created_at: string
          failure_reason: string | null
          id: string
          keywords: string[]
          plan_month: string
          planned_for: string
          related_handles: string[]
          search_intent: string | null
          slug_hint: string | null
          status: string
          target_query: string | null
          title: string
          updated_at: string
        }
        Insert: {
          angle?: string | null
          article_id?: string | null
          attempts?: number
          audience?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          keywords?: string[]
          plan_month: string
          planned_for: string
          related_handles?: string[]
          search_intent?: string | null
          slug_hint?: string | null
          status?: string
          target_query?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          angle?: string | null
          article_id?: string | null
          attempts?: number
          audience?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          keywords?: string[]
          plan_month?: string
          planned_for?: string
          related_handles?: string[]
          search_intent?: string | null
          slug_hint?: string | null
          status?: string
          target_query?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "editorial_plan_items_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          integration_id: string | null
          message: string | null
          payload: Json
          status: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          integration_id?: string | null
          message?: string | null
          payload?: Json
          status?: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          integration_id?: string | null
          message?: string | null
          payload?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_events_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_settings: {
        Row: {
          created_at: string
          help_text: string | null
          id: string
          integration_id: string
          is_secret_reference: boolean
          key: string
          label: string
          required: boolean
          secret_name: string | null
          updated_at: string
          value: string | null
          value_type: string
        }
        Insert: {
          created_at?: string
          help_text?: string | null
          id?: string
          integration_id: string
          is_secret_reference?: boolean
          key: string
          label: string
          required?: boolean
          secret_name?: string | null
          updated_at?: string
          value?: string | null
          value_type?: string
        }
        Update: {
          created_at?: string
          help_text?: string | null
          id?: string
          integration_id?: string
          is_secret_reference?: boolean
          key?: string
          label?: string
          required?: boolean
          secret_name?: string | null
          updated_at?: string
          value?: string | null
          value_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_settings_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          config: Json
          created_at: string
          id: string
          label: string
          last_synced_at: string | null
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          label: string
          last_synced_at?: string | null
          provider: string
          status?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          label?: string
          last_synced_at?: string | null
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      intelligence_queue: {
        Row: {
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          lock_token: string | null
          locked_at: string | null
          priority: number
          processed_at: string | null
          product_id: string
          reason: string | null
          stage: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          lock_token?: string | null
          locked_at?: string | null
          priority?: number
          processed_at?: string | null
          product_id: string
          reason?: string | null
          stage: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          lock_token?: string | null
          locked_at?: string | null
          priority?: number
          processed_at?: string | null
          product_id?: string
          reason?: string | null
          stage?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intelligence_queue_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_documents: {
        Row: {
          body_markdown: string
          created_at: string
          doc_key: string
          effective_date: string | null
          id: string
          is_placeholder: boolean
          last_reviewed_at: string | null
          owner_notes: string | null
          slug: string
          status: Database["public"]["Enums"]["workflow_status"]
          summary: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          body_markdown?: string
          created_at?: string
          doc_key: string
          effective_date?: string | null
          id?: string
          is_placeholder?: boolean
          last_reviewed_at?: string | null
          owner_notes?: string | null
          slug: string
          status?: Database["public"]["Enums"]["workflow_status"]
          summary?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          body_markdown?: string
          created_at?: string
          doc_key?: string
          effective_date?: string | null
          id?: string
          is_placeholder?: boolean
          last_reviewed_at?: string | null
          owner_notes?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["workflow_status"]
          summary?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      legal_override_revisions: {
        Row: {
          action: string
          actor: string | null
          body_html: string | null
          created_at: string
          id: string
          source_id: string
          summary: string | null
          title: string | null
          upstream_fingerprint: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          body_html?: string | null
          created_at?: string
          id?: string
          source_id: string
          summary?: string | null
          title?: string | null
          upstream_fingerprint?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          body_html?: string | null
          created_at?: string
          id?: string
          source_id?: string
          summary?: string | null
          title?: string | null
          upstream_fingerprint?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_override_revisions_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "shopify_legal_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_source_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          draft_body_html: string
          draft_summary: string | null
          draft_title: string
          id: string
          notes: string | null
          published_at: string | null
          published_body_html: string | null
          published_summary: string | null
          published_title: string | null
          source_id: string
          updated_at: string
          updated_by: string | null
          upstream_fingerprint: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          draft_body_html?: string
          draft_summary?: string | null
          draft_title?: string
          id?: string
          notes?: string | null
          published_at?: string | null
          published_body_html?: string | null
          published_summary?: string | null
          published_title?: string | null
          source_id: string
          updated_at?: string
          updated_by?: string | null
          upstream_fingerprint?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          draft_body_html?: string
          draft_summary?: string | null
          draft_title?: string
          id?: string
          notes?: string | null
          published_at?: string | null
          published_body_html?: string | null
          published_summary?: string | null
          published_title?: string | null
          source_id?: string
          updated_at?: string
          updated_by?: string | null
          upstream_fingerprint?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_source_overrides_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: true
            referencedRelation: "shopify_legal_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_resources: {
        Row: {
          access_mode: string
          backing_tables: string[]
          blocked_reason: string | null
          created_at: string
          description: string
          id: string
          input_schema: Json
          label: string
          output_notes: string | null
          readiness: string
          resource_key: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          access_mode?: string
          backing_tables?: string[]
          blocked_reason?: string | null
          created_at?: string
          description: string
          id?: string
          input_schema?: Json
          label: string
          output_notes?: string | null
          readiness?: string
          resource_key: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          access_mode?: string
          backing_tables?: string[]
          blocked_reason?: string | null
          created_at?: string
          description?: string
          id?: string
          input_schema?: Json
          label?: string
          output_notes?: string | null
          readiness?: string
          resource_key?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      pricing_audit_items: {
        Row: {
          calculated_price: number | null
          cost_source: string | null
          created_at: string
          currency: string
          current_margin: number | null
          current_price: number | null
          evidence_status: string | null
          expected_fee: number | null
          expected_margin: number | null
          expected_payout: number | null
          expected_profit: number | null
          fee_fixed: number | null
          fee_variable: number | null
          fx_as_of: string | null
          fx_buffer_pct: number | null
          fx_effective_rate: number | null
          fx_reference_rate: number | null
          fx_source: string | null
          handle: string | null
          id: string
          landed_cost: number | null
          product_id: string | null
          product_title: string | null
          promo_margin: number | null
          promo_price: number | null
          promo_profit: number | null
          promo_within_floor: boolean | null
          proposed_margin: number | null
          protected_landed_cogs: number | null
          reason: string | null
          required_price: number | null
          run_id: string
          shipping_cost: number | null
          shipping_destination: string | null
          shipping_quoted_at: string | null
          shipping_service: string | null
          shipping_source: string | null
          shopify_product_id: string
          shopify_variant_id: string
          status: string
          supplier_additional_cost: number | null
          supplier_currency: string | null
          supplier_item_cost_source: number | null
          supplier_landed_total_source: number | null
          supplier_shipping_source_amount: number | null
          unit_cost: number | null
          variant_title: string | null
        }
        Insert: {
          calculated_price?: number | null
          cost_source?: string | null
          created_at?: string
          currency?: string
          current_margin?: number | null
          current_price?: number | null
          evidence_status?: string | null
          expected_fee?: number | null
          expected_margin?: number | null
          expected_payout?: number | null
          expected_profit?: number | null
          fee_fixed?: number | null
          fee_variable?: number | null
          fx_as_of?: string | null
          fx_buffer_pct?: number | null
          fx_effective_rate?: number | null
          fx_reference_rate?: number | null
          fx_source?: string | null
          handle?: string | null
          id?: string
          landed_cost?: number | null
          product_id?: string | null
          product_title?: string | null
          promo_margin?: number | null
          promo_price?: number | null
          promo_profit?: number | null
          promo_within_floor?: boolean | null
          proposed_margin?: number | null
          protected_landed_cogs?: number | null
          reason?: string | null
          required_price?: number | null
          run_id: string
          shipping_cost?: number | null
          shipping_destination?: string | null
          shipping_quoted_at?: string | null
          shipping_service?: string | null
          shipping_source?: string | null
          shopify_product_id: string
          shopify_variant_id: string
          status: string
          supplier_additional_cost?: number | null
          supplier_currency?: string | null
          supplier_item_cost_source?: number | null
          supplier_landed_total_source?: number | null
          supplier_shipping_source_amount?: number | null
          unit_cost?: number | null
          variant_title?: string | null
        }
        Update: {
          calculated_price?: number | null
          cost_source?: string | null
          created_at?: string
          currency?: string
          current_margin?: number | null
          current_price?: number | null
          evidence_status?: string | null
          expected_fee?: number | null
          expected_margin?: number | null
          expected_payout?: number | null
          expected_profit?: number | null
          fee_fixed?: number | null
          fee_variable?: number | null
          fx_as_of?: string | null
          fx_buffer_pct?: number | null
          fx_effective_rate?: number | null
          fx_reference_rate?: number | null
          fx_source?: string | null
          handle?: string | null
          id?: string
          landed_cost?: number | null
          product_id?: string | null
          product_title?: string | null
          promo_margin?: number | null
          promo_price?: number | null
          promo_profit?: number | null
          promo_within_floor?: boolean | null
          proposed_margin?: number | null
          protected_landed_cogs?: number | null
          reason?: string | null
          required_price?: number | null
          run_id?: string
          shipping_cost?: number | null
          shipping_destination?: string | null
          shipping_quoted_at?: string | null
          shipping_service?: string | null
          shipping_source?: string | null
          shopify_product_id?: string
          shopify_variant_id?: string
          status?: string
          supplier_additional_cost?: number | null
          supplier_currency?: string | null
          supplier_item_cost_source?: number | null
          supplier_landed_total_source?: number | null
          supplier_shipping_source_amount?: number | null
          unit_cost?: number | null
          variant_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_audit_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_audit_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pricing_audit_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_audit_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          message: string | null
          mode: string
          settings: Json
          status: string
          totals: Json
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          message?: string | null
          mode?: string
          settings?: Json
          status?: string
          totals?: Json
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          message?: string | null
          mode?: string
          settings?: Json
          status?: string
          totals?: Json
          updated_at?: string
        }
        Relationships: []
      }
      pricing_backfill_state: {
        Row: {
          completed_at: string | null
          created_at: string
          cursor: string | null
          id: string
          updated_at: string
          variants_held: number
          variants_priced: number
          variants_seen: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          cursor?: string | null
          id: string
          updated_at?: string
          variants_held?: number
          variants_priced?: number
          variants_seen?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          cursor?: string | null
          id?: string
          updated_at?: string
          variants_held?: number
          variants_priced?: number
          variants_seen?: number
        }
        Relationships: []
      }
      pricing_formula_policy: {
        Row: {
          activation_enabled: boolean
          activation_note: string | null
          created_at: string
          formula_version: string
          id: boolean
          updated_at: string
        }
        Insert: {
          activation_enabled?: boolean
          activation_note?: string | null
          created_at?: string
          formula_version: string
          id?: boolean
          updated_at?: string
        }
        Update: {
          activation_enabled?: boolean
          activation_note?: string | null
          created_at?: string
          formula_version?: string
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      product_classification_history: {
        Row: {
          actor: string | null
          confidence: number | null
          confidence_tier: string | null
          created_at: string
          id: string
          new_category_slug: string | null
          previous_category_slug: string | null
          product_id: string
          reason: string | null
          source: string
          supplier_category: string | null
        }
        Insert: {
          actor?: string | null
          confidence?: number | null
          confidence_tier?: string | null
          created_at?: string
          id?: string
          new_category_slug?: string | null
          previous_category_slug?: string | null
          product_id: string
          reason?: string | null
          source?: string
          supplier_category?: string | null
        }
        Update: {
          actor?: string | null
          confidence?: number | null
          confidence_tier?: string | null
          created_at?: string
          id?: string
          new_category_slug?: string | null
          previous_category_slug?: string | null
          product_id?: string
          reason?: string | null
          source?: string
          supplier_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_classification_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_classifications: {
        Row: {
          anomaly_flags: Json
          auto_published: boolean
          category_id: string | null
          category_slug: string | null
          classifier_model: string | null
          classifier_version: string | null
          confidence: number
          confidence_tier: string
          created_at: string
          duplicate_of_product_id: string | null
          id: string
          input_fingerprint: string | null
          last_classified_at: string | null
          needs_attention: boolean
          product_id: string
          quality_issues: Json
          quality_score: number
          reasoning: string | null
          supplier_product_type: string | null
          supplier_tags: string[]
          supplier_vendor: string | null
          updated_at: string
        }
        Insert: {
          anomaly_flags?: Json
          auto_published?: boolean
          category_id?: string | null
          category_slug?: string | null
          classifier_model?: string | null
          classifier_version?: string | null
          confidence?: number
          confidence_tier?: string
          created_at?: string
          duplicate_of_product_id?: string | null
          id?: string
          input_fingerprint?: string | null
          last_classified_at?: string | null
          needs_attention?: boolean
          product_id: string
          quality_issues?: Json
          quality_score?: number
          reasoning?: string | null
          supplier_product_type?: string | null
          supplier_tags?: string[]
          supplier_vendor?: string | null
          updated_at?: string
        }
        Update: {
          anomaly_flags?: Json
          auto_published?: boolean
          category_id?: string | null
          category_slug?: string | null
          classifier_model?: string | null
          classifier_version?: string | null
          confidence?: number
          confidence_tier?: string
          created_at?: string
          duplicate_of_product_id?: string | null
          id?: string
          input_fingerprint?: string | null
          last_classified_at?: string | null
          needs_attention?: boolean
          product_id?: string
          quality_issues?: Json
          quality_score?: number
          reasoning?: string | null
          supplier_product_type?: string | null
          supplier_tags?: string[]
          supplier_vendor?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_classifications_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "catalogue_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_classifications_duplicate_of_product_id_fkey"
            columns: ["duplicate_of_product_id"]
            isOneToOne: false
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_classifications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_enrichment: {
        Row: {
          benefits: Json
          care_information: string | null
          created_at: string
          delivery_information: string | null
          faqs: Json
          id: string
          long_description: string | null
          notes: string | null
          product_id: string
          specifications: Json
          status: Database["public"]["Enums"]["workflow_status"]
          summary: string | null
          updated_at: string
          updated_by: string | null
          use_cases: Json
        }
        Insert: {
          benefits?: Json
          care_information?: string | null
          created_at?: string
          delivery_information?: string | null
          faqs?: Json
          id?: string
          long_description?: string | null
          notes?: string | null
          product_id: string
          specifications?: Json
          status?: Database["public"]["Enums"]["workflow_status"]
          summary?: string | null
          updated_at?: string
          updated_by?: string | null
          use_cases?: Json
        }
        Update: {
          benefits?: Json
          care_information?: string | null
          created_at?: string
          delivery_information?: string | null
          faqs?: Json
          id?: string
          long_description?: string | null
          notes?: string | null
          product_id?: string
          specifications?: Json
          status?: Database["public"]["Enums"]["workflow_status"]
          summary?: string | null
          updated_at?: string
          updated_by?: string | null
          use_cases?: Json
        }
        Relationships: [
          {
            foreignKeyName: "product_enrichment_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_identity_signals: {
        Row: {
          attribute_tokens: string[]
          barcodes: string[]
          created_at: string
          identity_fingerprint: string | null
          image_signatures: string[]
          model_codes: string[]
          pack_quantity: number | null
          product_id: string
          skus: string[]
          spec_signature: string | null
          updated_at: string
          variant_signature: string | null
          vendor_key: string | null
        }
        Insert: {
          attribute_tokens?: string[]
          barcodes?: string[]
          created_at?: string
          identity_fingerprint?: string | null
          image_signatures?: string[]
          model_codes?: string[]
          pack_quantity?: number | null
          product_id: string
          skus?: string[]
          spec_signature?: string | null
          updated_at?: string
          variant_signature?: string | null
          vendor_key?: string | null
        }
        Update: {
          attribute_tokens?: string[]
          barcodes?: string[]
          created_at?: string
          identity_fingerprint?: string | null
          image_signatures?: string[]
          model_codes?: string[]
          pack_quantity?: number | null
          product_id?: string
          skus?: string[]
          spec_signature?: string | null
          updated_at?: string
          variant_signature?: string | null
          vendor_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_identity_signals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_intake_events: {
        Row: {
          created_at: string
          detail: Json
          from_state: string | null
          id: string
          intake_id: string
          message: string | null
          reason_code: string | null
          shopify_product_id: string | null
          to_state: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          from_state?: string | null
          id?: string
          intake_id: string
          message?: string | null
          reason_code?: string | null
          shopify_product_id?: string | null
          to_state: string
        }
        Update: {
          created_at?: string
          detail?: Json
          from_state?: string | null
          id?: string
          intake_id?: string
          message?: string | null
          reason_code?: string | null
          shopify_product_id?: string | null
          to_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_intake_events_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "product_intake_records"
            referencedColumns: ["id"]
          },
        ]
      }
      product_intake_policy: {
        Row: {
          automatic_processing: boolean
          automatic_storefront_exposure: boolean
          catalogue_classification: boolean
          created_at: string
          duplicate_protection: boolean
          id: string
          require_description: boolean
          require_image: boolean
          require_purchasable_variant: boolean
          require_valid_price: boolean
          seo_intelligence: boolean
          updated_at: string
        }
        Insert: {
          automatic_processing?: boolean
          automatic_storefront_exposure?: boolean
          catalogue_classification?: boolean
          created_at?: string
          duplicate_protection?: boolean
          id?: string
          require_description?: boolean
          require_image?: boolean
          require_purchasable_variant?: boolean
          require_valid_price?: boolean
          seo_intelligence?: boolean
          updated_at?: string
        }
        Update: {
          automatic_processing?: boolean
          automatic_storefront_exposure?: boolean
          catalogue_classification?: boolean
          created_at?: string
          duplicate_protection?: boolean
          id?: string
          require_description?: boolean
          require_image?: boolean
          require_purchasable_variant?: boolean
          require_valid_price?: boolean
          seo_intelligence?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      product_intake_records: {
        Row: {
          approved_at: string | null
          attempts: number
          classified_at: string | null
          created_at: string
          detected_at: string
          failed_at: string | null
          handle: string | null
          id: string
          identity_at: string | null
          last_transition_at: string
          lock_token: string | null
          locked_at: string | null
          material_fingerprint: string | null
          metrics: Json
          origin: string
          previous_state: string | null
          processed_fingerprint: string | null
          product_id: string | null
          published_at: string | null
          quarantined_at: string | null
          reason: string | null
          reason_code: string | null
          rejected_at: string | null
          seo_at: string | null
          shopify_product_id: string
          source: string
          state: string
          title: string | null
          updated_at: string
          validated_at: string | null
          validation: Json
          version_fingerprint: string | null
        }
        Insert: {
          approved_at?: string | null
          attempts?: number
          classified_at?: string | null
          created_at?: string
          detected_at?: string
          failed_at?: string | null
          handle?: string | null
          id?: string
          identity_at?: string | null
          last_transition_at?: string
          lock_token?: string | null
          locked_at?: string | null
          material_fingerprint?: string | null
          metrics?: Json
          origin?: string
          previous_state?: string | null
          processed_fingerprint?: string | null
          product_id?: string | null
          published_at?: string | null
          quarantined_at?: string | null
          reason?: string | null
          reason_code?: string | null
          rejected_at?: string | null
          seo_at?: string | null
          shopify_product_id: string
          source?: string
          state?: string
          title?: string | null
          updated_at?: string
          validated_at?: string | null
          validation?: Json
          version_fingerprint?: string | null
        }
        Update: {
          approved_at?: string | null
          attempts?: number
          classified_at?: string | null
          created_at?: string
          detected_at?: string
          failed_at?: string | null
          handle?: string | null
          id?: string
          identity_at?: string | null
          last_transition_at?: string
          lock_token?: string | null
          locked_at?: string | null
          material_fingerprint?: string | null
          metrics?: Json
          origin?: string
          previous_state?: string | null
          processed_fingerprint?: string | null
          product_id?: string | null
          published_at?: string | null
          quarantined_at?: string | null
          reason?: string | null
          reason_code?: string | null
          rejected_at?: string | null
          seo_at?: string | null
          shopify_product_id?: string
          source?: string
          state?: string
          title?: string | null
          updated_at?: string
          validated_at?: string | null
          validation?: Json
          version_fingerprint?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_intake_records_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_market_eligibility: {
        Row: {
          created_at: string
          eligible: boolean
          id: string
          market: string
          product_id: string | null
          quoted_at: string | null
          reason: string | null
          shipping_amount: number | null
          shipping_currency: string | null
          shipping_service: string | null
          shopify_product_id: string | null
          status: string
          supplier_product_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          eligible?: boolean
          id?: string
          market: string
          product_id?: string | null
          quoted_at?: string | null
          reason?: string | null
          shipping_amount?: number | null
          shipping_currency?: string | null
          shipping_service?: string | null
          shopify_product_id?: string | null
          status?: string
          supplier_product_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          eligible?: boolean
          id?: string
          market?: string
          product_id?: string | null
          quoted_at?: string | null
          reason?: string | null
          shipping_amount?: number | null
          shipping_currency?: string | null
          shipping_service?: string | null
          shopify_product_id?: string | null
          status?: string
          supplier_product_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_price_authority: {
        Row: {
          authority_source: string
          cost_observed_at: string | null
          cost_source: string | null
          created_at: string
          currency: string
          drift_detected_at: string | null
          expected_price: number | null
          formula_inputs: Json
          formula_version: string
          hold_reason: string | null
          id: string
          idempotency_key: string | null
          input_hash: string | null
          inventory_item_id: string | null
          landed_cost: number | null
          landed_cost_verified_at: string | null
          last_app_write_at: string | null
          last_push_error: string | null
          last_push_status: string | null
          last_pushed_at: string | null
          next_attempt_at: string | null
          observed_at: string | null
          observed_shopify_price: number | null
          product_id: string
          push_attempts: number
          push_state: string
          shipping_quoted_at: string | null
          shipping_source: string | null
          shopify_product_id: string
          shopify_variant_id: string
          unit_cost: number | null
          updated_at: string
          variant_title: string | null
        }
        Insert: {
          authority_source?: string
          cost_observed_at?: string | null
          cost_source?: string | null
          created_at?: string
          currency?: string
          drift_detected_at?: string | null
          expected_price?: number | null
          formula_inputs?: Json
          formula_version: string
          hold_reason?: string | null
          id?: string
          idempotency_key?: string | null
          input_hash?: string | null
          inventory_item_id?: string | null
          landed_cost?: number | null
          landed_cost_verified_at?: string | null
          last_app_write_at?: string | null
          last_push_error?: string | null
          last_push_status?: string | null
          last_pushed_at?: string | null
          next_attempt_at?: string | null
          observed_at?: string | null
          observed_shopify_price?: number | null
          product_id: string
          push_attempts?: number
          push_state?: string
          shipping_quoted_at?: string | null
          shipping_source?: string | null
          shopify_product_id: string
          shopify_variant_id: string
          unit_cost?: number | null
          updated_at?: string
          variant_title?: string | null
        }
        Update: {
          authority_source?: string
          cost_observed_at?: string | null
          cost_source?: string | null
          created_at?: string
          currency?: string
          drift_detected_at?: string | null
          expected_price?: number | null
          formula_inputs?: Json
          formula_version?: string
          hold_reason?: string | null
          id?: string
          idempotency_key?: string | null
          input_hash?: string | null
          inventory_item_id?: string | null
          landed_cost?: number | null
          landed_cost_verified_at?: string | null
          last_app_write_at?: string | null
          last_push_error?: string | null
          last_push_status?: string | null
          last_pushed_at?: string | null
          next_attempt_at?: string | null
          observed_at?: string | null
          observed_shopify_price?: number | null
          product_id?: string
          push_attempts?: number
          push_state?: string
          shipping_quoted_at?: string | null
          shipping_source?: string | null
          shopify_product_id?: string
          shopify_variant_id?: string
          unit_cost?: number | null
          updated_at?: string
          variant_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_price_authority_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_price_revisions: {
        Row: {
          applied_by: string | null
          cost_source: string | null
          created_at: string
          expected_fee: number | null
          expected_margin: number | null
          expected_payout: number | null
          expected_profit: number | null
          fee_fixed: number | null
          fee_variable: number | null
          fx_as_of: string | null
          fx_buffer_pct: number | null
          fx_effective_rate: number | null
          fx_reference_rate: number | null
          fx_source: string | null
          id: string
          landed_cost: number | null
          new_price: number
          old_price: number | null
          product_id: string | null
          protected_landed_cogs: number | null
          required_price: number | null
          rounding_mode: string | null
          run_id: string | null
          shipping_cost: number | null
          shipping_destination: string | null
          shipping_quoted_at: string | null
          shipping_service: string | null
          shipping_source: string | null
          shopify_product_id: string
          shopify_variant_id: string
          source: string
          supplier_currency: string | null
          supplier_landed_total_source: number | null
          target_margin: number | null
          unit_cost: number | null
          variant_title: string | null
        }
        Insert: {
          applied_by?: string | null
          cost_source?: string | null
          created_at?: string
          expected_fee?: number | null
          expected_margin?: number | null
          expected_payout?: number | null
          expected_profit?: number | null
          fee_fixed?: number | null
          fee_variable?: number | null
          fx_as_of?: string | null
          fx_buffer_pct?: number | null
          fx_effective_rate?: number | null
          fx_reference_rate?: number | null
          fx_source?: string | null
          id?: string
          landed_cost?: number | null
          new_price: number
          old_price?: number | null
          product_id?: string | null
          protected_landed_cogs?: number | null
          required_price?: number | null
          rounding_mode?: string | null
          run_id?: string | null
          shipping_cost?: number | null
          shipping_destination?: string | null
          shipping_quoted_at?: string | null
          shipping_service?: string | null
          shipping_source?: string | null
          shopify_product_id: string
          shopify_variant_id: string
          source?: string
          supplier_currency?: string | null
          supplier_landed_total_source?: number | null
          target_margin?: number | null
          unit_cost?: number | null
          variant_title?: string | null
        }
        Update: {
          applied_by?: string | null
          cost_source?: string | null
          created_at?: string
          expected_fee?: number | null
          expected_margin?: number | null
          expected_payout?: number | null
          expected_profit?: number | null
          fee_fixed?: number | null
          fee_variable?: number | null
          fx_as_of?: string | null
          fx_buffer_pct?: number | null
          fx_effective_rate?: number | null
          fx_reference_rate?: number | null
          fx_source?: string | null
          id?: string
          landed_cost?: number | null
          new_price?: number
          old_price?: number | null
          product_id?: string | null
          protected_landed_cogs?: number | null
          required_price?: number | null
          rounding_mode?: string | null
          run_id?: string | null
          shipping_cost?: number | null
          shipping_destination?: string | null
          shipping_quoted_at?: string | null
          shipping_service?: string | null
          shipping_source?: string | null
          shopify_product_id?: string
          shopify_variant_id?: string
          source?: string
          supplier_currency?: string | null
          supplier_landed_total_source?: number | null
          target_margin?: number | null
          unit_cost?: number | null
          variant_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_price_revisions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_price_revisions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pricing_audit_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      product_pricing_lifecycle: {
        Row: {
          activation_result: string | null
          attempts: number
          created_at: string
          formula_version: string | null
          id: string
          input_hash: string | null
          last_app_write_at: string | null
          last_priced_at: string | null
          next_attempt_at: string | null
          product_id: string | null
          publication_result: string | null
          reason: string | null
          shopify_product_id: string
          status: string
          updated_at: string
          variants_total: number
          variants_verified: number
          verified_at: string | null
        }
        Insert: {
          activation_result?: string | null
          attempts?: number
          created_at?: string
          formula_version?: string | null
          id?: string
          input_hash?: string | null
          last_app_write_at?: string | null
          last_priced_at?: string | null
          next_attempt_at?: string | null
          product_id?: string | null
          publication_result?: string | null
          reason?: string | null
          shopify_product_id: string
          status?: string
          updated_at?: string
          variants_total?: number
          variants_verified?: number
          verified_at?: string | null
        }
        Update: {
          activation_result?: string | null
          attempts?: number
          created_at?: string
          formula_version?: string | null
          id?: string
          input_hash?: string | null
          last_app_write_at?: string | null
          last_priced_at?: string | null
          next_attempt_at?: string | null
          product_id?: string | null
          publication_result?: string | null
          reason?: string | null
          shopify_product_id?: string
          status?: string
          updated_at?: string
          variants_total?: number
          variants_verified?: number
          verified_at?: string | null
        }
        Relationships: []
      }
      product_seo_intelligence: {
        Row: {
          auto_published: boolean
          collection_relevance: Json
          created_at: string
          description_sections: Json
          entities: string[]
          entity_summary: string | null
          faqs: Json
          id: string
          identity_checked_at: string | null
          identity_findings: Json
          image_alt: string | null
          input_hash: string | null
          intelligence_version: string | null
          internal_links: Json
          issues: Json
          keywords: string[]
          last_analysed_at: string | null
          manual_review_reason: string | null
          meta_description: string | null
          model: string | null
          og_description: string | null
          og_title: string | null
          optimisation_score: number
          primary_topic: string | null
          product_id: string
          regeneration_attempts: number
          schema_inputs: Json
          seo_title: string | null
          slug_recommendation: string | null
          updated_at: string
          validation_state: string
        }
        Insert: {
          auto_published?: boolean
          collection_relevance?: Json
          created_at?: string
          description_sections?: Json
          entities?: string[]
          entity_summary?: string | null
          faqs?: Json
          id?: string
          identity_checked_at?: string | null
          identity_findings?: Json
          image_alt?: string | null
          input_hash?: string | null
          intelligence_version?: string | null
          internal_links?: Json
          issues?: Json
          keywords?: string[]
          last_analysed_at?: string | null
          manual_review_reason?: string | null
          meta_description?: string | null
          model?: string | null
          og_description?: string | null
          og_title?: string | null
          optimisation_score?: number
          primary_topic?: string | null
          product_id: string
          regeneration_attempts?: number
          schema_inputs?: Json
          seo_title?: string | null
          slug_recommendation?: string | null
          updated_at?: string
          validation_state?: string
        }
        Update: {
          auto_published?: boolean
          collection_relevance?: Json
          created_at?: string
          description_sections?: Json
          entities?: string[]
          entity_summary?: string | null
          faqs?: Json
          id?: string
          identity_checked_at?: string | null
          identity_findings?: Json
          image_alt?: string | null
          input_hash?: string | null
          intelligence_version?: string | null
          internal_links?: Json
          issues?: Json
          keywords?: string[]
          last_analysed_at?: string | null
          manual_review_reason?: string | null
          meta_description?: string | null
          model?: string | null
          og_description?: string | null
          og_title?: string | null
          optimisation_score?: number
          primary_topic?: string | null
          product_id?: string
          regeneration_attempts?: number
          schema_inputs?: Json
          seo_title?: string | null
          slug_recommendation?: string | null
          updated_at?: string
          validation_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_seo_intelligence_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_supplier_links: {
        Row: {
          consecutive_sync_failures: number
          created_at: string
          evidence: Json
          fx_as_of: string | null
          fx_rate: number | null
          held_at: string | null
          held_reason: string | null
          id: string
          landed_cost: number | null
          last_error: string | null
          last_supplier_sync_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          manual_hold: boolean
          match_confidence: string
          match_method: string
          next_retry_at: string | null
          product_id: string | null
          quoted_amount: number | null
          quoted_currency: string | null
          recovered_at: string | null
          retry_count: number
          shipping_cost: number | null
          shipping_currency: string
          shipping_destination: string | null
          shipping_quoted_at: string | null
          shipping_service: string | null
          shipping_source: string | null
          shopify_product_id: string
          supplier: string
          supplier_available: boolean | null
          supplier_cost: number | null
          supplier_cost_currency: string | null
          supplier_import_list_id: string | null
          supplier_inventory: number | null
          supplier_product_id: string
          supplier_status: string | null
          sync_reason: string | null
          sync_state: string
          updated_at: string
          variant_map: Json
          variant_map_synced_at: string | null
          variant_stock: Json | null
          verified_at: string
        }
        Insert: {
          consecutive_sync_failures?: number
          created_at?: string
          evidence?: Json
          fx_as_of?: string | null
          fx_rate?: number | null
          held_at?: string | null
          held_reason?: string | null
          id?: string
          landed_cost?: number | null
          last_error?: string | null
          last_supplier_sync_at?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          manual_hold?: boolean
          match_confidence?: string
          match_method: string
          next_retry_at?: string | null
          product_id?: string | null
          quoted_amount?: number | null
          quoted_currency?: string | null
          recovered_at?: string | null
          retry_count?: number
          shipping_cost?: number | null
          shipping_currency?: string
          shipping_destination?: string | null
          shipping_quoted_at?: string | null
          shipping_service?: string | null
          shipping_source?: string | null
          shopify_product_id: string
          supplier?: string
          supplier_available?: boolean | null
          supplier_cost?: number | null
          supplier_cost_currency?: string | null
          supplier_import_list_id?: string | null
          supplier_inventory?: number | null
          supplier_product_id: string
          supplier_status?: string | null
          sync_reason?: string | null
          sync_state?: string
          updated_at?: string
          variant_map?: Json
          variant_map_synced_at?: string | null
          variant_stock?: Json | null
          verified_at?: string
        }
        Update: {
          consecutive_sync_failures?: number
          created_at?: string
          evidence?: Json
          fx_as_of?: string | null
          fx_rate?: number | null
          held_at?: string | null
          held_reason?: string | null
          id?: string
          landed_cost?: number | null
          last_error?: string | null
          last_supplier_sync_at?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          manual_hold?: boolean
          match_confidence?: string
          match_method?: string
          next_retry_at?: string | null
          product_id?: string | null
          quoted_amount?: number | null
          quoted_currency?: string | null
          recovered_at?: string | null
          retry_count?: number
          shipping_cost?: number | null
          shipping_currency?: string
          shipping_destination?: string | null
          shipping_quoted_at?: string | null
          shipping_service?: string | null
          shipping_source?: string | null
          shopify_product_id?: string
          supplier?: string
          supplier_available?: boolean | null
          supplier_cost?: number | null
          supplier_cost_currency?: string | null
          supplier_import_list_id?: string | null
          supplier_inventory?: number | null
          supplier_product_id?: string
          supplier_status?: string | null
          sync_reason?: string | null
          sync_state?: string
          updated_at?: string
          variant_map?: Json
          variant_map_synced_at?: string | null
          variant_stock?: Json | null
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_supplier_links_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      prompt_versions: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key: string
          label: string
          model_hint: string | null
          notes: string | null
          provider_hint: string | null
          stage: Database["public"]["Enums"]["workflow_stage"]
          template: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          label: string
          model_hint?: string | null
          notes?: string | null
          provider_hint?: string | null
          stage: Database["public"]["Enums"]["workflow_stage"]
          template: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          model_hint?: string | null
          notes?: string | null
          provider_hint?: string | null
          stage?: Database["public"]["Enums"]["workflow_stage"]
          template?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      publication_audit_items: {
        Row: {
          changed: boolean
          created_at: string
          current_channels: string[]
          desired_channels: string[]
          drifted: boolean
          id: string
          message: string | null
          product_status: string | null
          product_title: string | null
          run_id: string
          shopify_product_id: string
          to_publish: string[]
          to_unpublish: string[]
          updated_at: string
        }
        Insert: {
          changed?: boolean
          created_at?: string
          current_channels?: string[]
          desired_channels?: string[]
          drifted?: boolean
          id?: string
          message?: string | null
          product_status?: string | null
          product_title?: string | null
          run_id: string
          shopify_product_id: string
          to_publish?: string[]
          to_unpublish?: string[]
          updated_at?: string
        }
        Update: {
          changed?: boolean
          created_at?: string
          current_channels?: string[]
          desired_channels?: string[]
          drifted?: boolean
          id?: string
          message?: string | null
          product_status?: string | null
          product_title?: string | null
          run_id?: string
          shopify_product_id?: string
          to_publish?: string[]
          to_unpublish?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "publication_audit_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "publication_audit_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      publication_audit_runs: {
        Row: {
          created_at: string
          created_by: string | null
          desired_channels: string[]
          id: string
          mode: string
          note: string | null
          products_changed: number
          products_drifted: number
          products_inspected: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          desired_channels?: string[]
          id?: string
          mode?: string
          note?: string | null
          products_changed?: number
          products_drifted?: number
          products_inspected?: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          desired_channels?: string[]
          id?: string
          mode?: string
          note?: string | null
          products_changed?: number
          products_drifted?: number
          products_inspected?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      review_placements: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          embed_snippet: string | null
          enabled: boolean
          id: string
          label: string
          notes: string | null
          placement_key: string
          provider: string
          surface: Database["public"]["Enums"]["placement_surface"]
          updated_at: string
          widget_reference: string | null
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          embed_snippet?: string | null
          enabled?: boolean
          id?: string
          label: string
          notes?: string | null
          placement_key: string
          provider?: string
          surface: Database["public"]["Enums"]["placement_surface"]
          updated_at?: string
          widget_reference?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          embed_snippet?: string | null
          enabled?: boolean
          id?: string
          label?: string
          notes?: string | null
          placement_key?: string
          provider?: string
          surface?: Database["public"]["Enums"]["placement_surface"]
          updated_at?: string
          widget_reference?: string | null
        }
        Relationships: []
      }
      seo_entities: {
        Row: {
          created_at: string
          description: string | null
          entity_type: string | null
          id: string
          name: string
          same_as_urls: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          entity_type?: string | null
          id?: string
          name: string
          same_as_urls?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          entity_type?: string | null
          id?: string
          name?: string
          same_as_urls?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      seo_questions: {
        Row: {
          answer: string | null
          created_at: string
          id: string
          include_in_faq_schema: boolean
          question: string
          seo_record_id: string
          source_url: string | null
          updated_at: string
        }
        Insert: {
          answer?: string | null
          created_at?: string
          id?: string
          include_in_faq_schema?: boolean
          question: string
          seo_record_id: string
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          answer?: string | null
          created_at?: string
          id?: string
          include_in_faq_schema?: boolean
          question?: string
          seo_record_id?: string
          source_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seo_questions_seo_record_id_fkey"
            columns: ["seo_record_id"]
            isOneToOne: false
            referencedRelation: "seo_records"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_records: {
        Row: {
          canonical_url: string | null
          created_at: string
          entity_ids: string[]
          id: string
          internal_link_targets: Json
          last_reviewed_at: string | null
          meta_description: string | null
          meta_title: string | null
          notes: string | null
          optimisation_status: Database["public"]["Enums"]["optimisation_status"]
          schema_type: string | null
          search_intent: string | null
          secondary_queries: string[]
          target_label: string | null
          target_query: string | null
          target_reference: string
          target_type: Database["public"]["Enums"]["seo_target_type"]
          updated_at: string
        }
        Insert: {
          canonical_url?: string | null
          created_at?: string
          entity_ids?: string[]
          id?: string
          internal_link_targets?: Json
          last_reviewed_at?: string | null
          meta_description?: string | null
          meta_title?: string | null
          notes?: string | null
          optimisation_status?: Database["public"]["Enums"]["optimisation_status"]
          schema_type?: string | null
          search_intent?: string | null
          secondary_queries?: string[]
          target_label?: string | null
          target_query?: string | null
          target_reference: string
          target_type: Database["public"]["Enums"]["seo_target_type"]
          updated_at?: string
        }
        Update: {
          canonical_url?: string | null
          created_at?: string
          entity_ids?: string[]
          id?: string
          internal_link_targets?: Json
          last_reviewed_at?: string | null
          meta_description?: string | null
          meta_title?: string | null
          notes?: string | null
          optimisation_status?: Database["public"]["Enums"]["optimisation_status"]
          schema_type?: string | null
          search_intent?: string | null
          secondary_queries?: string[]
          target_label?: string | null
          target_query?: string | null
          target_reference?: string
          target_type?: Database["public"]["Enums"]["seo_target_type"]
          updated_at?: string
        }
        Relationships: []
      }
      shopify_collections: {
        Row: {
          created_at: string
          description: string | null
          description_html: string | null
          handle: string
          id: string
          image_url: string | null
          last_synced_at: string | null
          product_count: number
          raw: Json
          seo_description: string | null
          seo_title: string | null
          shopify_collection_id: string
          shopify_updated_at: string | null
          sync_status: Database["public"]["Enums"]["sync_status"]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          description_html?: string | null
          handle: string
          id?: string
          image_url?: string | null
          last_synced_at?: string | null
          product_count?: number
          raw?: Json
          seo_description?: string | null
          seo_title?: string | null
          shopify_collection_id: string
          shopify_updated_at?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status"]
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          description_html?: string | null
          handle?: string
          id?: string
          image_url?: string | null
          last_synced_at?: string | null
          product_count?: number
          raw?: Json
          seo_description?: string | null
          seo_title?: string | null
          shopify_collection_id?: string
          shopify_updated_at?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      shopify_legal_sources: {
        Row: {
          body_html: string
          body_summary: string | null
          created_at: string
          exclude_reason: string | null
          handle: string | null
          has_liquid: boolean
          has_placeholders: boolean
          id: string
          is_published: boolean
          last_synced_at: string
          liquid_tokens: string[]
          placeholder_tokens: string[]
          policy_type: string | null
          public_visible: boolean
          review_status: string
          shopify_created_at: string | null
          shopify_id: string
          shopify_published_at: string | null
          shopify_updated_at: string | null
          slug: string
          source_type: string
          source_url: string | null
          sync_error: string | null
          sync_status: string
          title: string
          updated_at: string
        }
        Insert: {
          body_html?: string
          body_summary?: string | null
          created_at?: string
          exclude_reason?: string | null
          handle?: string | null
          has_liquid?: boolean
          has_placeholders?: boolean
          id?: string
          is_published?: boolean
          last_synced_at?: string
          liquid_tokens?: string[]
          placeholder_tokens?: string[]
          policy_type?: string | null
          public_visible?: boolean
          review_status?: string
          shopify_created_at?: string | null
          shopify_id: string
          shopify_published_at?: string | null
          shopify_updated_at?: string | null
          slug: string
          source_type: string
          source_url?: string | null
          sync_error?: string | null
          sync_status?: string
          title: string
          updated_at?: string
        }
        Update: {
          body_html?: string
          body_summary?: string | null
          created_at?: string
          exclude_reason?: string | null
          handle?: string | null
          has_liquid?: boolean
          has_placeholders?: boolean
          id?: string
          is_published?: boolean
          last_synced_at?: string
          liquid_tokens?: string[]
          placeholder_tokens?: string[]
          policy_type?: string | null
          public_visible?: boolean
          review_status?: string
          shopify_created_at?: string | null
          shopify_id?: string
          shopify_published_at?: string | null
          shopify_updated_at?: string | null
          slug?: string
          source_type?: string
          source_url?: string | null
          sync_error?: string | null
          sync_status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      shopify_product_collections: {
        Row: {
          collection_id: string
          created_at: string
          product_id: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          product_id: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_product_collections_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "shopify_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopify_product_collections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_product_media: {
        Row: {
          alt_text: string | null
          created_at: string
          height: number | null
          id: string
          media_type: string | null
          position: number
          product_id: string
          shopify_media_id: string
          url: string
          width: number | null
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          height?: number | null
          id?: string
          media_type?: string | null
          position?: number
          product_id: string
          shopify_media_id: string
          url: string
          width?: number | null
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          height?: number | null
          id?: string
          media_type?: string | null
          position?: number
          product_id?: string
          shopify_media_id?: string
          url?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shopify_product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_product_variants: {
        Row: {
          available_for_sale: boolean | null
          barcode: string | null
          compare_at_price: number | null
          cost_source: string | null
          cost_synced_at: string | null
          created_at: string
          currency: string | null
          id: string
          image_url: string | null
          inventory_quantity: number | null
          last_synced_at: string | null
          position: number
          price: number | null
          product_id: string
          selected_options: Json
          shopify_updated_at: string | null
          shopify_variant_id: string
          sku: string | null
          title: string
          unit_cost: number | null
          unit_cost_currency: string | null
        }
        Insert: {
          available_for_sale?: boolean | null
          barcode?: string | null
          compare_at_price?: number | null
          cost_source?: string | null
          cost_synced_at?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          image_url?: string | null
          inventory_quantity?: number | null
          last_synced_at?: string | null
          position?: number
          price?: number | null
          product_id: string
          selected_options?: Json
          shopify_updated_at?: string | null
          shopify_variant_id: string
          sku?: string | null
          title: string
          unit_cost?: number | null
          unit_cost_currency?: string | null
        }
        Update: {
          available_for_sale?: boolean | null
          barcode?: string | null
          compare_at_price?: number | null
          cost_source?: string | null
          cost_synced_at?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          image_url?: string | null
          inventory_quantity?: number | null
          last_synced_at?: string | null
          position?: number
          price?: number | null
          product_id?: string
          selected_options?: Json
          shopify_updated_at?: string | null
          shopify_variant_id?: string
          sku?: string | null
          title?: string
          unit_cost?: number | null
          unit_cost_currency?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shopify_product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_products: {
        Row: {
          available_for_sale: boolean | null
          compare_at_price_max: number | null
          compare_at_price_min: number | null
          created_at: string
          currency: string | null
          description: string | null
          description_html: string | null
          featured_image_url: string | null
          handle: string
          id: string
          last_synced_at: string | null
          online_store_url: string | null
          options: Json
          price_max: number | null
          price_min: number | null
          product_type: string | null
          raw: Json
          seo_description: string | null
          seo_title: string | null
          shopify_product_id: string
          shopify_updated_at: string | null
          status: string | null
          sync_status: Database["public"]["Enums"]["sync_status"]
          tags: string[]
          title: string
          total_inventory: number | null
          updated_at: string
          variant_count: number
          vendor: string | null
        }
        Insert: {
          available_for_sale?: boolean | null
          compare_at_price_max?: number | null
          compare_at_price_min?: number | null
          created_at?: string
          currency?: string | null
          description?: string | null
          description_html?: string | null
          featured_image_url?: string | null
          handle: string
          id?: string
          last_synced_at?: string | null
          online_store_url?: string | null
          options?: Json
          price_max?: number | null
          price_min?: number | null
          product_type?: string | null
          raw?: Json
          seo_description?: string | null
          seo_title?: string | null
          shopify_product_id: string
          shopify_updated_at?: string | null
          status?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status"]
          tags?: string[]
          title: string
          total_inventory?: number | null
          updated_at?: string
          variant_count?: number
          vendor?: string | null
        }
        Update: {
          available_for_sale?: boolean | null
          compare_at_price_max?: number | null
          compare_at_price_min?: number | null
          created_at?: string
          currency?: string | null
          description?: string | null
          description_html?: string | null
          featured_image_url?: string | null
          handle?: string
          id?: string
          last_synced_at?: string | null
          online_store_url?: string | null
          options?: Json
          price_max?: number | null
          price_min?: number | null
          product_type?: string | null
          raw?: Json
          seo_description?: string | null
          seo_title?: string | null
          shopify_product_id?: string
          shopify_updated_at?: string | null
          status?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status"]
          tags?: string[]
          title?: string
          total_inventory?: number | null
          updated_at?: string
          variant_count?: number
          vendor?: string | null
        }
        Relationships: []
      }
      storefront_checkout_state: {
        Row: {
          checked_at: string
          checkout_domain: string | null
          checkout_ready: boolean
          id: boolean
          storefront_checkout: boolean
        }
        Insert: {
          checked_at?: string
          checkout_domain?: string | null
          checkout_ready?: boolean
          id?: boolean
          storefront_checkout?: boolean
        }
        Update: {
          checked_at?: string
          checkout_domain?: string | null
          checkout_ready?: boolean
          id?: boolean
          storefront_checkout?: boolean
        }
        Relationships: []
      }
      storefront_snapshot: {
        Row: {
          available_for_sale: boolean | null
          category_name: string | null
          category_slug: string | null
          collection_handles: string[]
          compare_at_price_min: number | null
          currency: string | null
          handle: string
          image_url: string | null
          price_max: number | null
          price_min: number | null
          product_id: string
          product_type: string | null
          refreshed_at: string
          search_text: string | null
          seo_description: string | null
          seo_title: string | null
          summary: string | null
          tags: string[]
          title: string
          updated_at: string | null
          variant_count: number
          vendor: string | null
        }
        Insert: {
          available_for_sale?: boolean | null
          category_name?: string | null
          category_slug?: string | null
          collection_handles?: string[]
          compare_at_price_min?: number | null
          currency?: string | null
          handle: string
          image_url?: string | null
          price_max?: number | null
          price_min?: number | null
          product_id: string
          product_type?: string | null
          refreshed_at?: string
          search_text?: string | null
          seo_description?: string | null
          seo_title?: string | null
          summary?: string | null
          tags?: string[]
          title: string
          updated_at?: string | null
          variant_count?: number
          vendor?: string | null
        }
        Update: {
          available_for_sale?: boolean | null
          category_name?: string | null
          category_slug?: string | null
          collection_handles?: string[]
          compare_at_price_min?: number | null
          currency?: string | null
          handle?: string
          image_url?: string | null
          price_max?: number | null
          price_min?: number | null
          product_id?: string
          product_type?: string | null
          refreshed_at?: string
          search_text?: string | null
          seo_description?: string | null
          seo_title?: string | null
          summary?: string | null
          tags?: string[]
          title?: string
          updated_at?: string | null
          variant_count?: number
          vendor?: string | null
        }
        Relationships: []
      }
      storefront_snapshot_meta: {
        Row: {
          id: boolean
          product_count: number
          refreshed_at: string
          version: number
        }
        Insert: {
          id?: boolean
          product_count?: number
          refreshed_at?: string
          version?: number
        }
        Update: {
          id?: boolean
          product_count?: number
          refreshed_at?: string
          version?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      zendrop_capabilities: {
        Row: {
          action_name: string
          available: boolean
          created_at: string
          description: string | null
          id: string
          input_schema: Json
          kind: string
          last_checked_at: string | null
          updated_at: string
        }
        Insert: {
          action_name: string
          available?: boolean
          created_at?: string
          description?: string | null
          id?: string
          input_schema?: Json
          kind?: string
          last_checked_at?: string | null
          updated_at?: string
        }
        Update: {
          action_name?: string
          available?: boolean
          created_at?: string
          description?: string | null
          id?: string
          input_schema?: Json
          kind?: string
          last_checked_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      zendrop_import_candidates: {
        Row: {
          attempts: number
          calculated_price: number | null
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          failure_reason: string | null
          gross_margin: number | null
          hold_reason: string | null
          id: string
          idempotency_key: string
          image_url: string | null
          imported_at: string | null
          is_test: boolean
          landed_cost: number | null
          linked_at: string | null
          live_at: string | null
          lock_token: string | null
          locked_at: string | null
          previous_state: string | null
          pricing_complete: boolean
          pricing_snapshot: Json
          product_id: string | null
          queued_at: string | null
          score_reasons: Json
          screening: Json
          shipping_cost: number | null
          shopify_product_id: string | null
          state: string
          store_reference: string | null
          suggested_retail: number | null
          suitability_score: number | null
          supplier_cost: number | null
          supplier_payload: Json
          title: string
          updated_at: string
          write_response: Json
          zendrop_product_id: string
          zendrop_variant_ids: string[]
        }
        Insert: {
          attempts?: number
          calculated_price?: number | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          failure_reason?: string | null
          gross_margin?: number | null
          hold_reason?: string | null
          id?: string
          idempotency_key: string
          image_url?: string | null
          imported_at?: string | null
          is_test?: boolean
          landed_cost?: number | null
          linked_at?: string | null
          live_at?: string | null
          lock_token?: string | null
          locked_at?: string | null
          previous_state?: string | null
          pricing_complete?: boolean
          pricing_snapshot?: Json
          product_id?: string | null
          queued_at?: string | null
          score_reasons?: Json
          screening?: Json
          shipping_cost?: number | null
          shopify_product_id?: string | null
          state?: string
          store_reference?: string | null
          suggested_retail?: number | null
          suitability_score?: number | null
          supplier_cost?: number | null
          supplier_payload?: Json
          title: string
          updated_at?: string
          write_response?: Json
          zendrop_product_id: string
          zendrop_variant_ids?: string[]
        }
        Update: {
          attempts?: number
          calculated_price?: number | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          failure_reason?: string | null
          gross_margin?: number | null
          hold_reason?: string | null
          id?: string
          idempotency_key?: string
          image_url?: string | null
          imported_at?: string | null
          is_test?: boolean
          landed_cost?: number | null
          linked_at?: string | null
          live_at?: string | null
          lock_token?: string | null
          locked_at?: string | null
          previous_state?: string | null
          pricing_complete?: boolean
          pricing_snapshot?: Json
          product_id?: string | null
          queued_at?: string | null
          score_reasons?: Json
          screening?: Json
          shipping_cost?: number | null
          shopify_product_id?: string | null
          state?: string
          store_reference?: string | null
          suggested_retail?: number | null
          suitability_score?: number | null
          supplier_cost?: number | null
          supplier_payload?: Json
          title?: string
          updated_at?: string
          write_response?: Json
          zendrop_product_id?: string
          zendrop_variant_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "zendrop_import_candidates_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
        ]
      }
      zendrop_import_events: {
        Row: {
          candidate_id: string | null
          created_at: string
          detail: Json
          from_state: string | null
          id: string
          message: string | null
          reason_code: string | null
          to_state: string
          zendrop_product_id: string | null
        }
        Insert: {
          candidate_id?: string | null
          created_at?: string
          detail?: Json
          from_state?: string | null
          id?: string
          message?: string | null
          reason_code?: string | null
          to_state: string
          zendrop_product_id?: string | null
        }
        Update: {
          candidate_id?: string | null
          created_at?: string
          detail?: Json
          from_state?: string | null
          id?: string
          message?: string | null
          reason_code?: string | null
          to_state?: string
          zendrop_product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "zendrop_import_events_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "zendrop_import_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      zendrop_pricing_settings: {
        Row: {
          allow_incomplete_pricing: boolean
          created_at: string
          currency: string
          free_shipping_market: string
          free_shipping_markets: string[]
          fx_buffer_pct: number
          fx_quote_max_age_hours: number
          fx_source: string
          id: string
          min_promo_margin: number
          payment_fee_fixed: number
          payment_fee_variable: number
          pricing_mode: string
          promo_discount: number
          rounding_mode: string
          shipping_market: string
          shipping_quote_max_age_days: number
          supported_markets: string[]
          target_margin: number
          updated_at: string
        }
        Insert: {
          allow_incomplete_pricing?: boolean
          created_at?: string
          currency?: string
          free_shipping_market?: string
          free_shipping_markets?: string[]
          fx_buffer_pct?: number
          fx_quote_max_age_hours?: number
          fx_source?: string
          id?: string
          min_promo_margin?: number
          payment_fee_fixed?: number
          payment_fee_variable?: number
          pricing_mode?: string
          promo_discount?: number
          rounding_mode?: string
          shipping_market?: string
          shipping_quote_max_age_days?: number
          supported_markets?: string[]
          target_margin?: number
          updated_at?: string
        }
        Update: {
          allow_incomplete_pricing?: boolean
          created_at?: string
          currency?: string
          free_shipping_market?: string
          free_shipping_markets?: string[]
          fx_buffer_pct?: number
          fx_quote_max_age_hours?: number
          fx_source?: string
          id?: string
          min_promo_margin?: number
          payment_fee_fixed?: number
          payment_fee_variable?: number
          pricing_mode?: string
          promo_discount?: number
          rounding_mode?: string
          shipping_market?: string
          shipping_quote_max_age_days?: number
          supported_markets?: string[]
          target_margin?: number
          updated_at?: string
        }
        Relationships: []
      }
      zendrop_sourcing_rules: {
        Row: {
          allowed_categories: string[]
          auto_recovery_enabled: boolean
          batch_size: number
          blocked_categories: string[]
          continuous_sourcing: boolean
          created_at: string
          daily_import_cap: number
          discovery_market_mode: string
          duplicate_precheck: boolean
          enabled: boolean
          freshness_target_hours: number
          id: string
          inventory_policy_override: boolean
          max_landed_cost: number | null
          max_retail_price: number | null
          max_variant_count: number | null
          min_landed_cost: number | null
          min_retail_price: number | null
          min_suitability_score: number
          refresh_headroom_pct: number
          refresh_max_batch: number
          refresh_min_batch: number
          refresh_runs_per_hour: number
          require_image: boolean
          require_stock: boolean
          require_uk_shipping: boolean
          restricted_keywords: string[]
          scan_cursor: string | null
          scan_cycle: number
          scan_exhausted_at: string | null
          scan_last_at: string | null
          scan_page: number
          scan_pages_per_run: number
          target_catalogue_size: number | null
          updated_at: string
        }
        Insert: {
          allowed_categories?: string[]
          auto_recovery_enabled?: boolean
          batch_size?: number
          blocked_categories?: string[]
          continuous_sourcing?: boolean
          created_at?: string
          daily_import_cap?: number
          discovery_market_mode?: string
          duplicate_precheck?: boolean
          enabled?: boolean
          freshness_target_hours?: number
          id?: string
          inventory_policy_override?: boolean
          max_landed_cost?: number | null
          max_retail_price?: number | null
          max_variant_count?: number | null
          min_landed_cost?: number | null
          min_retail_price?: number | null
          min_suitability_score?: number
          refresh_headroom_pct?: number
          refresh_max_batch?: number
          refresh_min_batch?: number
          refresh_runs_per_hour?: number
          require_image?: boolean
          require_stock?: boolean
          require_uk_shipping?: boolean
          restricted_keywords?: string[]
          scan_cursor?: string | null
          scan_cycle?: number
          scan_exhausted_at?: string | null
          scan_last_at?: string | null
          scan_page?: number
          scan_pages_per_run?: number
          target_catalogue_size?: number | null
          updated_at?: string
        }
        Update: {
          allowed_categories?: string[]
          auto_recovery_enabled?: boolean
          batch_size?: number
          blocked_categories?: string[]
          continuous_sourcing?: boolean
          created_at?: string
          daily_import_cap?: number
          discovery_market_mode?: string
          duplicate_precheck?: boolean
          enabled?: boolean
          freshness_target_hours?: number
          id?: string
          inventory_policy_override?: boolean
          max_landed_cost?: number | null
          max_retail_price?: number | null
          max_variant_count?: number | null
          min_landed_cost?: number | null
          min_retail_price?: number | null
          min_suitability_score?: number
          refresh_headroom_pct?: number
          refresh_max_batch?: number
          refresh_min_batch?: number
          refresh_runs_per_hour?: number
          require_image?: boolean
          require_stock?: boolean
          require_uk_shipping?: boolean
          restricted_keywords?: string[]
          scan_cursor?: string | null
          scan_cycle?: number
          scan_exhausted_at?: string | null
          scan_last_at?: string | null
          scan_page?: number
          scan_pages_per_run?: number
          target_catalogue_size?: number | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_product_categories: {
        Row: {
          category_slug: string | null
          product_id: string | null
        }
        Insert: {
          category_slug?: string | null
          product_id?: string | null
        }
        Update: {
          category_slug?: string | null
          product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_classifications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "shopify_products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      claim_supplier_links: {
        Args: { _batch: number; _lease_seconds?: number; _owner: string }
        Returns: {
          consecutive_sync_failures: number
          created_at: string
          evidence: Json
          fx_as_of: string | null
          fx_rate: number | null
          held_at: string | null
          held_reason: string | null
          id: string
          landed_cost: number | null
          last_error: string | null
          last_supplier_sync_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          manual_hold: boolean
          match_confidence: string
          match_method: string
          next_retry_at: string | null
          product_id: string | null
          quoted_amount: number | null
          quoted_currency: string | null
          recovered_at: string | null
          retry_count: number
          shipping_cost: number | null
          shipping_currency: string
          shipping_destination: string | null
          shipping_quoted_at: string | null
          shipping_service: string | null
          shipping_source: string | null
          shopify_product_id: string
          supplier: string
          supplier_available: boolean | null
          supplier_cost: number | null
          supplier_cost_currency: string | null
          supplier_import_list_id: string | null
          supplier_inventory: number | null
          supplier_product_id: string
          supplier_status: string | null
          sync_reason: string | null
          sync_state: string
          updated_at: string
          variant_map: Json
          variant_map_synced_at: string | null
          variant_stock: Json | null
          verified_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "product_supplier_links"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      delete_integration_secret: { Args: { _name: string }; Returns: undefined }
      get_integration_secret: { Args: { _name: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hidden_intake_product_ids: {
        Args: never
        Returns: {
          product_id: string
        }[]
      }
      pricing_gate_stats: { Args: never; Returns: Json }
      pricing_lifecycle_stats: { Args: never; Returns: Json }
      public_legal_references: {
        Args: never
        Returns: {
          slug: string
          source_url: string
          title: string
        }[]
      }
      public_product_categories: {
        Args: never
        Returns: {
          category_slug: string
          product_id: string
        }[]
      }
      public_suppressed_products: {
        Args: never
        Returns: {
          canonical_handle: string
          product_id: string
        }[]
      }
      recover_stale_automation_runs: {
        Args: { _budget_minutes?: number }
        Returns: number
      }
      refresh_product_price_range: {
        Args: { _product_id: string }
        Returns: undefined
      }
      refresh_storefront_snapshot: { Args: never; Returns: number }
      set_integration_secret: {
        Args: { _name: string; _secret: string }
        Returns: undefined
      }
      supplier_sync_health: { Args: { _stale_hours?: number }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "staff" | "viewer"
      optimisation_status:
        | "not_started"
        | "in_progress"
        | "needs_review"
        | "optimised"
      placement_surface:
        | "homepage"
        | "product_page"
        | "collection_page"
        | "cart"
        | "article_page"
        | "reviews_page"
        | "footer"
        | "custom"
      run_status: "queued" | "running" | "succeeded" | "failed" | "cancelled"
      seo_target_type: "product" | "collection" | "article" | "page"
      sync_status: "pending" | "synced" | "stale" | "error"
      workflow_stage:
        | "topic_discovery"
        | "brief"
        | "research"
        | "draft"
        | "source_verification"
        | "optimisation"
        | "internal_links"
        | "metadata_schema"
        | "approval"
        | "scheduling"
      workflow_status:
        | "draft"
        | "in_review"
        | "scheduled"
        | "published"
        | "archived"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "staff", "viewer"],
      optimisation_status: [
        "not_started",
        "in_progress",
        "needs_review",
        "optimised",
      ],
      placement_surface: [
        "homepage",
        "product_page",
        "collection_page",
        "cart",
        "article_page",
        "reviews_page",
        "footer",
        "custom",
      ],
      run_status: ["queued", "running", "succeeded", "failed", "cancelled"],
      seo_target_type: ["product", "collection", "article", "page"],
      sync_status: ["pending", "synced", "stale", "error"],
      workflow_stage: [
        "topic_discovery",
        "brief",
        "research",
        "draft",
        "source_verification",
        "optimisation",
        "internal_links",
        "metadata_schema",
        "approval",
        "scheduling",
      ],
      workflow_status: [
        "draft",
        "in_review",
        "scheduled",
        "published",
        "archived",
      ],
    },
  },
} as const
