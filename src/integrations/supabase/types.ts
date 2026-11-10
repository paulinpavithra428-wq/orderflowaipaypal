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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action_type: string
          created_at: string
          description: string
          details: Json
          id: string
          investigation_id: string | null
          order_id: string | null
        }
        Insert: {
          action_type: string
          created_at?: string
          description: string
          details?: Json
          id?: string
          investigation_id?: string | null
          order_id?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string
          description?: string
          details?: Json
          id?: string
          investigation_id?: string | null
          order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "investigations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      investigations: {
        Row: {
          ai_generated: boolean
          bottleneck_key: string
          bottleneck_label: string
          confidence: number
          created_at: string
          decided_at: string | null
          evidence: Json
          explanation: string
          finding: string
          id: string
          message_recipient: string | null
          message_subject: string | null
          order_id: string
          payment_source: string
          priority: string
          recommended_action: string
          status: string
          suggested_message: string | null
        }
        Insert: {
          ai_generated?: boolean
          bottleneck_key: string
          bottleneck_label: string
          confidence: number
          created_at?: string
          decided_at?: string | null
          evidence?: Json
          explanation: string
          finding: string
          id?: string
          message_recipient?: string | null
          message_subject?: string | null
          order_id: string
          payment_source?: string
          priority: string
          recommended_action: string
          status?: string
          suggested_message?: string | null
        }
        Update: {
          ai_generated?: boolean
          bottleneck_key?: string
          bottleneck_label?: string
          confidence?: number
          created_at?: string
          decided_at?: string | null
          evidence?: Json
          explanation?: string
          finding?: string
          id?: string
          message_recipient?: string | null
          message_subject?: string | null
          order_id?: string
          payment_source?: string
          priority?: string
          recommended_action?: string
          status?: string
          suggested_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investigations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          amount: number
          carrier: string | null
          created_at: string
          currency: string
          customer_email: string
          customer_name: string
          delivery_status: string
          id: string
          inventory_on_hand: number
          inventory_status: string
          ordered_at: string
          paypal_payment_status: string
          paypal_transaction_id: string | null
          product: string
          quantity: number
          sku: string
          supplier_email: string
          supplier_name: string
          supplier_status: string
          tracking_number: string | null
        }
        Insert: {
          amount: number
          carrier?: string | null
          created_at?: string
          currency?: string
          customer_email: string
          customer_name: string
          delivery_status?: string
          id: string
          inventory_on_hand?: number
          inventory_status?: string
          ordered_at?: string
          paypal_payment_status?: string
          paypal_transaction_id?: string | null
          product: string
          quantity?: number
          sku: string
          supplier_email: string
          supplier_name: string
          supplier_status?: string
          tracking_number?: string | null
        }
        Update: {
          amount?: number
          carrier?: string | null
          created_at?: string
          currency?: string
          customer_email?: string
          customer_name?: string
          delivery_status?: string
          id?: string
          inventory_on_hand?: number
          inventory_status?: string
          ordered_at?: string
          paypal_payment_status?: string
          paypal_transaction_id?: string | null
          product?: string
          quantity?: number
          sku?: string
          supplier_email?: string
          supplier_name?: string
          supplier_status?: string
          tracking_number?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
