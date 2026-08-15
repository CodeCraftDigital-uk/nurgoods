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
          compare_at_price: number | null
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
        }
        Insert: {
          available_for_sale?: boolean | null
          compare_at_price?: number | null
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
        }
        Update: {
          available_for_sale?: boolean | null
          compare_at_price?: number | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_integration_secret: { Args: { _name: string }; Returns: undefined }
      get_integration_secret: { Args: { _name: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      set_integration_secret: {
        Args: { _name: string; _secret: string }
        Returns: undefined
      }
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
