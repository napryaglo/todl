import ExampleRunnerVM from "./example-runner-vm.ts"
import DiagnosticVM from "./diagnostic-vm.ts"

resources ExampleRunner {
    DataTemplate [DataType = DiagnosticVM] {
        TextBlock [ Margin = (0,0,0,2), FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 12, Text = $Line ]
    }
    DataTemplate [DataType = ExampleRunnerVM] {
        UniformGrid [ Columns = 2 ] {
            Border [ Margin = (8,8,8,8) ] { ContentControl [ Content = $Editor ] }
            DockPanel [ Margin = (8,8,8,8) ] {
                DockPanel [ DockPanel.Dock = Top, Margin = (0,0,0,6) ] {
                    Button [ DockPanel.Dock = Right, Command = $Download ] { TextBlock [ Text = "Download" ] }
                    Button [ DockPanel.Dock = Right, Command = $Copy, Margin = (0,0,4,0) ] { TextBlock [ Text = "Copy JSON" ] }
                    Button [ DockPanel.Dock = Right, Command = $ToggleDebug, Margin = (0,0,4,0) ] { TextBlock [ Text = $DebugLabel ] }
                    TextBlock [ FontWeight = Bold, Text = $Status ]
                }
                StackPanel [ DockPanel.Dock = Top, Orientation = Horizontal, Margin = (0,0,0,6) ] {
                    Button [ Command = $ShowTokens, Margin = (0,0,3,0) ] { TextBlock [ Text = "Tokens" ] }
                    Button [ Command = $ShowAst,    Margin = (0,0,3,0) ] { TextBlock [ Text = "AST" ] }
                    Button [ Command = $ShowModel,  Margin = (0,0,3,0) ] { TextBlock [ Text = "Model" ] }
                    Button [ Command = $ShowDiag,   Margin = (0,0,3,0) ] { TextBlock [ Text = "Diag" ] }
                    Button [ Command = $ShowJson,   Margin = (0,0,3,0) ] { TextBlock [ Text = "JSON" ] }
                    Button [ Command = $ShowGraph ]                      { TextBlock [ Text = "Graph" ] }
                }
                Grid {
                    ContentControl [ Visibility = $TokensVisibility, Content = $TokensView ]
                    ContentControl [ Visibility = $AstVisibility,    Content = $AstView ]
                    ContentControl [ Visibility = $ModelVisibility,  Content = $ModelView ]
                    ScrollViewer [ Visibility = $DiagVisibility ]   { ListBox [ Items = $Diagnostics ] }
                    ContentControl [ Visibility = $JsonVisibility,  Content = $JsonView ]
                    DockPanel [ Visibility = $GraphVisibility ] {
                        StackPanel [ DockPanel.Dock = Top, Orientation = Horizontal, Margin = (0,0,0,6) ] {
                            Button [ Command = $ZoomOut, Margin = (0,0,4,0) ] { TextBlock [ Text = "−" ] }
                            Button [ Command = $ZoomIn,  Margin = (0,0,4,0) ] { TextBlock [ Text = "+" ] }
                            Button [ Command = $Fit ]                         { TextBlock [ Text = "Fit" ] }
                        }
                        Border [ DockPanel.Dock = Bottom, Fill = @SurfaceVariant, Margin = (0,6,0,0) ] {
                            TextBlock [ Margin = (6,4,6,4), FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 11, TextWrapping = NoWrap, Text = $SelectedNodeText ]
                        }
                        ContentControl [ Content = $Graph ]
                    }
                }
            }
        }
    }
}
