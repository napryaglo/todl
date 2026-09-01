import ExampleRunnerVM from "./example-runner-vm.ts"
import DiagnosticVM from "./diagnostic-vm.ts"

resources ExampleRunner {
    DataTemplate [DataType = DiagnosticVM] {
        TextBlock [ Margin = (0,0,0,2), FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 12, Text = $Line ]
    }
    DataTemplate [DataType = ExampleRunnerVM] {
        UniformGrid [ Columns = 2 ] {
            TextBox
                [ Margin        = (8,8,8,8),
                  AcceptsReturn = true,
                  AcceptsTab    = true,
                  TextWrapping  = NoWrap,
                  IsReadOnly    = $ReadOnly,
                  FontFamily    = "Cascadia Mono, Consolas, monospace",
                  FontSize      = 13,
                  Text          = $Source ]
            DockPanel [ Margin = (8,8,8,8) ] {
                TextBlock [ DockPanel.Dock = Top, FontWeight = Bold, Margin = (0,0,0,6), Text = $Status ]
                StackPanel [ DockPanel.Dock = Top, Orientation = Horizontal, Margin = (0,0,0,6) ] {
                    Button [ Command = $ShowTokens, Margin = (0,0,3,0) ] { TextBlock [ Text = "Tokens" ] }
                    Button [ Command = $ShowAst,    Margin = (0,0,3,0) ] { TextBlock [ Text = "AST" ] }
                    Button [ Command = $ShowModel,  Margin = (0,0,3,0) ] { TextBlock [ Text = "Model" ] }
                    Button [ Command = $ShowDiag,   Margin = (0,0,3,0) ] { TextBlock [ Text = "Diag" ] }
                    Button [ Command = $ShowJson,   Margin = (0,0,3,0) ] { TextBlock [ Text = "JSON" ] }
                    Button [ Command = $ShowGraph ]                      { TextBlock [ Text = "Graph" ] }
                }
                Grid {
                    ScrollViewer [ Visibility = $TokensVisibility ] { TextBlock [ FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 12, TextWrapping = NoWrap, Text = $TokensText ] }
                    ScrollViewer [ Visibility = $AstVisibility ]    { TextBlock [ FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 12, TextWrapping = NoWrap, Text = $AstText ] }
                    ScrollViewer [ Visibility = $ModelVisibility ]  { TextBlock [ FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 12, TextWrapping = NoWrap, Text = $ModelText ] }
                    ScrollViewer [ Visibility = $DiagVisibility ]   { ListBox [ Items = $Diagnostics ] }
                    ScrollViewer [ Visibility = $JsonVisibility ]   { TextBlock [ FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 12, TextWrapping = NoWrap, Text = $Json ] }
                    ScrollViewer [ Visibility = $GraphVisibility ]  { ContentControl [ Content = $Graph ] }
                }
            }
        }
    }
}
